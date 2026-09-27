import { nowIso } from '../db/connection';
import { Container } from '../container';
import { fieldError, notFound, conflict, businessRule } from '../errors';
import { Validator } from '../validation/validate';
import { toLocalDateKey } from '../money/format';
import { multiplyByMilliQuantity } from '../money/money';
import { paginate, readPaging, dateRangeFrom } from './patients';
import type { ApiSpec } from '../registry';

export const INVENTORY_TYPES = ['in', 'out', 'adjust', 'dispose'] as const;

/**
 * FEFO issue order: the batch that expires first is consumed first. Batches
 * with no expiry date are consumed last.
 */
export function pickBatchesForIssue(c: Container, itemId: number, quantity: number, batchId?: number): { batchId: number | null; quantity: number; unitCostPoisha: number }[] {
  if (batchId) {
    const batch = c.db.get<{ id: number; quantity_received: number; quantity_issued: number; unit_cost_poisha: number }>(
      'SELECT * FROM inventory_batches WHERE id = ? AND item_id = ?',
      [batchId, itemId],
    );
    if (!batch) throw notFound('Batch');
    const available = Number(batch.quantity_received) - Number(batch.quantity_issued);
    if (available < quantity) {
      throw businessRule(`Batch has only ${available} unit(s) available.`);
    }
    return [{ batchId, quantity, unitCostPoisha: Number(batch.unit_cost_poisha) }];
  }
  const batches = c.db.all<{ id: number; expiry_date: string | null; quantity_received: number; quantity_issued: number; unit_cost_poisha: number }>(
    'SELECT * FROM inventory_batches WHERE item_id = ? AND (quantity_received - quantity_issued) > 0 ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, id',
    [itemId],
  );
  let remaining = quantity;
  const picks: { batchId: number | null; quantity: number; unitCostPoisha: number }[] = [];
  for (const batch of batches) {
    if (remaining <= 0) break;
    const available = Number(batch.quantity_received) - Number(batch.quantity_issued);
    const take = Math.min(available, remaining);
    picks.push({ batchId: batch.id, quantity: take, unitCostPoisha: Number(batch.unit_cost_poisha) });
    remaining -= take;
  }
  if (remaining > 0) {
    throw businessRule(`Only ${quantity - remaining} unit(s) are in stock. Reduce the quantity or add stock first.`);
  }
  return picks;
}

export function recalcItemStock(c: Container, itemId: number): number {
  const row = c.db.get<{ total: number }>(
    `SELECT COALESCE(SUM(quantity_received - quantity_issued), 0) AS total FROM inventory_batches WHERE item_id = ?`,
    [itemId],
  );
  const total = Number(row?.total ?? 0);
  c.db.run('UPDATE inventory_items SET current_stock = ?, updated_at = ? WHERE id = ?', [total, nowIso(), itemId]);
  return total;
}

export const inventoryApi: ApiSpec = {
  inventory: {
    list: {
      perms: ['inventory.view'],
      label: 'List inventory items',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        const category = v.string('category', { max: 80 });
        const includeInactive = v.bool('includeInactive');
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (!includeInactive) where.push('is_active = 1');
        if (category) { where.push('category = ?'); params.push(category); }
        if (search) {
          where.push('(name LIKE ? COLLATE NOCASE OR sku LIKE ? COLLATE NOCASE)');
          params.push(`%${search}%`, `%${search}%`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = c.db.count(`SELECT COUNT(*) AS n FROM inventory_items ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT *, (current_stock <= min_stock) AS is_low,
                  (SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.item_id = inventory_items.id AND (b.quantity_received - b.quantity_issued) > 0) AS next_expiry
             FROM inventory_items ${whereSql} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    get: {
      perms: ['inventory.view'],
      label: 'Read inventory item',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const item = c.db.get(
          `SELECT *, (current_stock <= min_stock) AS is_low,
                  (SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.item_id = inventory_items.id
                    AND (b.quantity_received - b.quantity_issued) > 0) AS next_expiry
             FROM inventory_items WHERE id = ?`,
          [id],
        );
        if (!item) throw notFound('Inventory item');
        const batches = c.db.all(
          'SELECT * FROM inventory_batches WHERE item_id = ? ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, id',
          [id],
        );
        const transactions = c.db.all(
          `SELECT t.*, u.display_name AS performed_by_name, b.batch_no FROM inventory_transactions t
             LEFT JOIN users u ON u.id = t.performed_by LEFT JOIN inventory_batches b ON b.id = t.batch_id
            WHERE t.item_id = ? ORDER BY t.performed_at DESC, t.id DESC LIMIT 300`,
          [id],
        );
        return { item, batches, transactions };
      },
    },
    create: {
      perms: ['inventory.manage'],
      label: 'Create inventory item',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const name = v.string('name', { required: true, min: 2, max: 160, label: 'Item name' });
        const sku = v.string('sku', { required: true, min: 2, max: 40, label: 'SKU / code' });
        const category = v.string('category', { max: 80 });
        const unit = v.string('unit', { max: 20 });
        const minStock = v.int('minStock', { min: 0, max: 1000000 });
        const expiryAlertDays = v.int('expiryAlertDays', { min: 0, max: 3650 });
        const sellingPrice = v.int('sellingPricePoisha', { min: 0, max: 100000000000 });
        const notes = v.string('notes', { max: 1000 });
        v.throwIfInvalid('Please correct the highlighted fields.');
        if (c.db.get('SELECT id FROM inventory_items WHERE sku = ?', [sku])) throw conflict(`SKU "${sku}" is already in use.`);
        const now = nowIso();
        const id = c.db.insert(
          `INSERT INTO inventory_items (sku, name, category, unit, min_stock, expiry_alert_days, selling_price_poisha, current_stock, is_active, notes, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?, ?)`,
          [sku, name, category, unit || 'pcs', minStock, expiryAlertDays, sellingPrice, notes, now, now],
        );
        c.audit(actor, { action: 'inventory.item.create', entity: 'inventory_item', entityId: id, summary: `Inventory item "${name}" created` });
        return c.db.get('SELECT * FROM inventory_items WHERE id = ?', [id]);
      },
    },
    update: {
      perms: ['inventory.manage'],
      label: 'Update inventory item',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        const name = v.string('name', { required: true, min: 2, max: 160, label: 'Item name' });
        const sku = v.string('sku', { required: true, min: 2, max: 40, label: 'SKU / code' });
        const category = v.string('category', { max: 80 });
        const unit = v.string('unit', { max: 20 });
        const minStock = v.int('minStock', { min: 0, max: 1000000 });
        const expiryAlertDays = v.int('expiryAlertDays', { min: 0, max: 3650 });
        const sellingPrice = v.int('sellingPricePoisha', { min: 0, max: 100000000000 });
        const active = v.bool('isActive', true);
        const notes = v.string('notes', { max: 1000 });
        v.throwIfInvalid();
        if (!c.db.get('SELECT id FROM inventory_items WHERE id = ?', [id])) throw notFound('Inventory item');
        if (c.db.get('SELECT id FROM inventory_items WHERE sku = ? AND id <> ?', [sku, id])) throw conflict(`SKU "${sku}" is already in use.`);
        c.db.run(
          `UPDATE inventory_items SET sku = ?, name = ?, category = ?, unit = ?, min_stock = ?, expiry_alert_days = ?,
             selling_price_poisha = ?, is_active = ?, notes = ?, updated_at = ? WHERE id = ?`,
          [sku, name, category, unit, minStock, expiryAlertDays, sellingPrice, active ? 1 : 0, notes, nowIso(), id],
        );
        c.audit(actor, { action: 'inventory.item.update', entity: 'inventory_item', entityId: id, summary: `Inventory item "${name}" updated` });
        return c.db.get('SELECT * FROM inventory_items WHERE id = ?', [id]);
      },
    },
    stockIn: {
      perms: ['inventory.manage'],
      label: 'Receive stock',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const itemId = v.int('itemId', { required: true, min: 1 });
        const quantity = v.int('quantity', { required: true, min: 1, max: 1000000, label: 'Quantity' });
        const unitCost = v.int('unitCostPoisha', { min: 0, max: 100000000000 });
        const batchNo = v.string('batchNo', { max: 60 });
        const expiryDate = v.optionalString('expiryDate', 10);
        const purchaseDate = v.optionalString('purchaseDate', 10);
        const supplierId = v.optionalInt('supplierId');
        const location = v.string('location', { max: 100 });
        const reference = v.string('reference', { max: 120 });
        const note = v.string('note', { max: 500 });
        v.throwIfInvalid('Please correct the highlighted fields.');
        if (!c.db.get('SELECT id FROM inventory_items WHERE id = ?', [itemId])) throw notFound('Inventory item');
        if (expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) {
          throw fieldError([{ field: 'expiryDate', message: 'Expiry date must be a valid date.' }]);
        }

        return c.db.transaction(() => {
          const now = nowIso();
          const batchId = c.db.insert(
            `INSERT INTO inventory_batches (item_id, batch_no, expiry_date, purchase_date, supplier_id, unit_cost_poisha, quantity_received, quantity_issued, location, notes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [itemId, batchNo, expiryDate || null, purchaseDate || null, supplierId, unitCost, quantity, location, note, now],
          );
          c.db.run(
            `INSERT INTO inventory_transactions (item_id, batch_id, type, quantity, unit_cost_poisha, reference, note, performed_by, performed_at)
             VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?)`,
            [itemId, batchId, quantity, unitCost, reference, note, actor?.userId ?? null, now],
          );
          const stock = recalcItemStock(c, itemId);
          c.audit(actor, {
            action: 'inventory.stock_in', entity: 'inventory_item', entityId: itemId,
            summary: `Received ${quantity} × item #${itemId} (stock now ${stock})`,
            metadata: { batchId, quantity, stock },
          });
          return { batchId, currentStock: stock };
        });
      },
    },
    stockOut: {
      perms: ['inventory.manage'],
      label: 'Issue stock',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const itemId = v.int('itemId', { required: true, min: 1 });
        const quantity = v.int('quantity', { required: true, min: 1, max: 1000000, label: 'Quantity' });
        const batchId = v.optionalInt('batchId');
        const type = v.enum('type', ['out', 'dispose'] as const);
        const reference = v.string('reference', { max: 120 });
        const note = v.string('note', { max: 500 });
        v.throwIfInvalid('Please correct the highlighted fields.');
        const item = c.db.get<{ name: string; current_stock: number }>('SELECT name, current_stock FROM inventory_items WHERE id = ?', [itemId]);
        if (!item) throw notFound('Inventory item');

        return c.db.transaction(() => {
          const picks = pickBatchesForIssue(c, itemId, quantity, batchId ?? undefined);
          const now = nowIso();
          for (const pick of picks) {
            if (pick.batchId) {
              c.db.run('UPDATE inventory_batches SET quantity_issued = quantity_issued + ? WHERE id = ?', [pick.quantity, pick.batchId]);
            }
            c.db.run(
              `INSERT INTO inventory_transactions (item_id, batch_id, type, quantity, unit_cost_poisha, reference, note, performed_by, performed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [itemId, pick.batchId, type, pick.quantity, pick.unitCostPoisha, reference, note, actor?.userId ?? null, now],
            );
          }
          const stock = recalcItemStock(c, itemId);
          c.audit(actor, {
            action: type === 'out' ? 'inventory.stock_out' : 'inventory.dispose', entity: 'inventory_item', entityId: itemId,
            summary: `${type === 'out' ? 'Issued' : 'Disposed'} ${quantity} × ${item.name} (stock now ${stock})`,
            metadata: { quantity, stock },
          });
          return { currentStock: stock };
        });
      },
    },
    adjust: {
      perms: ['inventory.manage'],
      label: 'Adjust stock',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const itemId = v.int('itemId', { required: true, min: 1 });
        const newQuantity = v.int('newQuantity', { required: true, min: 0, max: 1000000, label: 'New quantity' });
        const reason = v.string('reason', { required: true, max: 300, label: 'Reason' });
        const batchId = v.optionalInt('batchId');
        v.throwIfInvalid();
        const item = c.db.get<{ name: string; current_stock: number }>('SELECT name, current_stock FROM inventory_items WHERE id = ?', [itemId]);
        if (!item) throw notFound('Inventory item');
        const delta = newQuantity - Number(item.current_stock);
        if (delta === 0) return { currentStock: newQuantity, unchanged: true };

        return c.db.transaction(() => {
          const now = nowIso();
          if (batchId) {
            const batch = c.db.get<{ quantity_received: number; quantity_issued: number }>(
              'SELECT quantity_received, quantity_issued FROM inventory_batches WHERE id = ? AND item_id = ?',
              [batchId, itemId],
            );
            if (!batch) throw notFound('Batch');
            const target = Number(batch.quantity_received) - Number(batch.quantity_issued) + delta;
            if (target < 0) throw businessRule('The adjustment would make the batch quantity negative.');
            c.db.run('UPDATE inventory_batches SET quantity_issued = ? WHERE id = ?', [Number(batch.quantity_issued) - delta, batchId]);
          } else if (delta > 0) {
            c.db.insert(
              `INSERT INTO inventory_batches (item_id, batch_no, quantity_received, quantity_issued, notes, created_at) VALUES (?, 'ADJUST', ?, 0, ?, ?)`,
              [itemId, delta, `Adjustment: ${reason}`, now],
            );
          } else {
            const picks = pickBatchesForIssue(c, itemId, -delta);
            for (const pick of picks) {
              if (pick.batchId) c.db.run('UPDATE inventory_batches SET quantity_issued = quantity_issued + ? WHERE id = ?', [pick.quantity, pick.batchId]);
            }
          }
          c.db.run(
            `INSERT INTO inventory_transactions (item_id, batch_id, type, quantity, reference, note, performed_by, performed_at)
             VALUES (?, ?, 'adjust', ?, 'ADJUST', ?, ?, ?)`,
            [itemId, batchId ?? null, delta, reason, actor?.userId ?? null, now],
          );
          const stock = recalcItemStock(c, itemId);
          c.audit(actor, {
            action: 'inventory.adjust', entity: 'inventory_item', entityId: itemId,
            summary: `Stock adjusted by ${delta > 0 ? '+' : ''}${delta} (${reason})`,
            metadata: { delta, stock },
          });
          return { currentStock: stock };
        });
      },
    },
    transactions: {
      perms: ['inventory.view'],
      label: 'List stock movements',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const itemId = v.optionalInt('itemId');
        const type = v.enum('type', ['', ...INVENTORY_TYPES] as const);
        const { from, to } = dateRangeFrom(input);
        const { page, pageSize, offset } = readPaging(input, { pageSize: 25, maxPageSize: 200 });
        const where: string[] = [];
        const params: (string | number)[] = [];
        if (itemId) { where.push('t.item_id = ?'); params.push(itemId); }
        if (type) { where.push('t.type = ?'); params.push(type); }
        if (from) { where.push('date(t.performed_at) >= ?'); params.push(from); }
        if (to) { where.push('date(t.performed_at) <= ?'); params.push(to); }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const total = c.db.count(`SELECT COUNT(*) AS n FROM inventory_transactions t ${whereSql}`, params);
        const rows = c.db.all(
          `SELECT t.*, i.name AS item_name, i.sku, i.unit, b.batch_no, u.display_name AS performed_by_name
             FROM inventory_transactions t JOIN inventory_items i ON i.id = t.item_id
             LEFT JOIN inventory_batches b ON b.id = t.batch_id LEFT JOIN users u ON u.id = t.performed_by
             ${whereSql} ORDER BY t.performed_at DESC, t.id DESC LIMIT ? OFFSET ?`,
          [...params, pageSize, offset],
        );
        return paginate(rows, total, page, pageSize);
      },
    },
    alerts: {
      perms: ['inventory.view'],
      label: 'Inventory alerts',
      handler: ({ c }) => {
        const today = toLocalDateKey(new Date());
        const alertDays = c.settings.get('inventory.expiryAlertDays');
        const lowStock = c.db.all(
          'SELECT id, sku, name, current_stock, min_stock, unit FROM inventory_items WHERE is_active = 1 AND current_stock <= min_stock ORDER BY current_stock ASC, name',
        );
        const outOfStock = c.db.all(
          'SELECT id, sku, name, current_stock, unit FROM inventory_items WHERE is_active = 1 AND current_stock <= 0 ORDER BY name',
        );
        const expiring = c.db.all(
          `SELECT b.id AS batch_id, b.batch_no, b.expiry_date, i.id AS item_id, i.name, i.sku, i.unit,
                  (b.quantity_received - b.quantity_issued) AS quantity
             FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
            WHERE (b.quantity_received - b.quantity_issued) > 0 AND b.expiry_date IS NOT NULL AND b.expiry_date <= ?
            ORDER BY b.expiry_date`,
          [`${shiftDate(today, alertDays)}`],
        );
        const expired = expiring.filter((b) => String(b.expiry_date) < today);
        return {
          lowStock,
          outOfStock,
          expiring: expiring.filter((b) => String(b.expiry_date) >= today),
          expired,
          alertDays,
        };
      },
    },
    valuation: {
      perms: ['accounting.view'],
      label: 'Inventory valuation',
      handler: ({ c }) => {
        // Valued from the batches that are still on hand rather than from a
        // single price per item, so a receipt at a new cost is reflected
        // exactly instead of being averaged away.
        const total = c.db.get<{ v: number }>(
          `SELECT COALESCE(SUM((b.quantity_received - b.quantity_issued) * b.unit_cost_poisha), 0) AS v
             FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
            WHERE i.is_active = 1 AND (b.quantity_received - b.quantity_issued) > 0`,
        );
        const byCategory = c.db.all<{ category: string; items: number; value_poisha: number; units: number }>(
          `SELECT COALESCE(NULLIF(i.category, ''), 'Uncategorised') AS category,
                  COUNT(DISTINCT i.id) AS items,
                  COALESCE(SUM((b.quantity_received - b.quantity_issued) * b.unit_cost_poisha), 0) AS value_poisha,
                  COALESCE(SUM(b.quantity_received - b.quantity_issued), 0) AS units
             FROM inventory_batches b JOIN inventory_items i ON i.id = b.item_id
            WHERE i.is_active = 1 AND (b.quantity_received - b.quantity_issued) > 0
            GROUP BY category ORDER BY value_poisha DESC`,
        );
        const purchases = c.db.get<{ v: number }>(
          `SELECT COALESCE(SUM(t.quantity * t.unit_cost_poisha), 0) AS v FROM inventory_transactions t WHERE t.type = 'in' AND t.performed_at >= ?`,
          [`${shiftDate(toLocalDateKey(new Date()), -30)}`],
        );
        return {
          stockValuePoisha: Number(total?.v ?? 0),
          purchasedLast30DaysPoisha: Number(purchases?.v ?? 0),
          byCategory,
        };
      },
    },
    purchaseOrders: {
      perms: ['inventory.view'],
      label: 'Suggested purchase list',
      handler: ({ c }) =>
        c.db.all(
          `SELECT id, sku, name, unit, min_stock, current_stock, (min_stock * 2 - current_stock) AS suggested_quantity
             FROM inventory_items WHERE is_active = 1 AND current_stock <= min_stock ORDER BY suggested_quantity DESC`,
        ),
    },
  },

  suppliers: {
    list: {
      perms: ['inventory.view'],
      label: 'List suppliers',
      handler: ({ c }, input: unknown) => {
        const v = new Validator(input);
        const search = v.string('search', { max: 120 });
        if (search) {
          return c.db.all('SELECT * FROM suppliers WHERE name LIKE ? COLLATE NOCASE ORDER BY name LIMIT 300', [`%${search}%`]);
        }
        return c.db.all('SELECT * FROM suppliers ORDER BY name LIMIT 500');
      },
    },
    save: {
      perms: ['inventory.manage'],
      label: 'Save supplier',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.optionalInt('id');
        const name = v.string('name', { required: true, min: 2, max: 160, label: 'Supplier name' });
        const contactPerson = v.string('contactPerson', { max: 120 });
        const phone = v.phone('phone');
        const email = v.string('email', { max: 160 });
        const address = v.string('address', { max: 300 });
        const notes = v.string('notes', { max: 500 });
        v.throwIfInvalid();
        if (id) {
          if (!c.db.get('SELECT id FROM suppliers WHERE id = ?', [id])) throw notFound('Supplier');
          c.db.run(
            'UPDATE suppliers SET name = ?, contact_person = ?, phone = ?, email = ?, address = ?, notes = ? WHERE id = ?',
            [name, contactPerson, phone, email, address, notes, id],
          );
          c.audit(actor, { action: 'inventory.supplier.update', entity: 'supplier', entityId: id, summary: `Supplier "${name}" updated` });
          return c.db.get('SELECT * FROM suppliers WHERE id = ?', [id]);
        }
        if (c.db.get('SELECT id FROM suppliers WHERE name = ?', [name])) throw conflict(`Supplier "${name}" already exists.`);
        const newId = c.db.insert(
          'INSERT INTO suppliers (name, contact_person, phone, email, address, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [name, contactPerson, phone, email, address, notes, nowIso()],
        );
        c.audit(actor, { action: 'inventory.supplier.create', entity: 'supplier', entityId: newId, summary: `Supplier "${name}" created` });
        return c.db.get('SELECT * FROM suppliers WHERE id = ?', [newId]);
      },
    },
    delete: {
      perms: ['inventory.manage'],
      label: 'Delete supplier',
      handler: ({ c, actor }, input: unknown) => {
        const v = new Validator(input);
        const id = v.int('id', { required: true, min: 1 });
        v.throwIfInvalid();
        const used = c.db.count('SELECT COUNT(*) AS n FROM inventory_batches WHERE supplier_id = ?', [id]);
        if (used > 0) throw businessRule('This supplier has purchase history and cannot be deleted.');
        c.db.run('DELETE FROM suppliers WHERE id = ?', [id]);
        c.audit(actor, { action: 'inventory.supplier.delete', entity: 'supplier', entityId: id, summary: 'Supplier deleted' });
        return { ok: true };
      },
    },
  },
};

function shiftDate(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toLocalDateKey(d);
}

export { multiplyByMilliQuantity, shiftDate };
