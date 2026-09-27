import { randomBytes } from 'node:crypto';
import {
  ALL_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_GROUPS,
  ADMIN_ONLY_PERMISSIONS,
  SEED_ROLES,
  type Permission,
  type RoleCode,
} from '../../shared/permissions';
import { permissionDenied } from '../errors';
import { Db, nowIso } from '../db/connection';

export interface Actor {
  userId: number;
  username: string;
  displayName: string;
  permissions: Set<Permission>;
  isAdministrator: boolean;
  sessionId: string;
  staffId: number | null;
  /** True while an administrator-issued password must still be replaced. */
  mustChangePassword: boolean;
}

export function seedRolesAndPermissions(db: Db): void {
  const now = nowIso();
  db.transaction(() => {
    for (const [index, permission] of ALL_PERMISSIONS.entries()) {
      const category = PERMISSION_GROUPS.find((g) => g.permissions.includes(permission))?.label ?? 'General';
      db.run(
        `INSERT INTO permissions (code, label, category) VALUES (?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET label = excluded.label, category = excluded.category`,
        [permission, PERMISSIONS[permission], category],
      );
      void index;
    }
    for (const [order, role] of SEED_ROLES.entries()) {
      db.run(
        `INSERT INTO roles (code, name, description, is_system, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`,
        [role.code, role.name, role.description, role.isSystem ? 1 : 0, now],
      );
      const row = db.get<{ id: number }>('SELECT id FROM roles WHERE code = ?', [role.code]);
      const roleId = Number(row?.id ?? 0);
      if (role.code === 'administrator') {
        // Administrator always holds the full catalogue, even if a role editor
        // removed something from the mapping table.
        db.run('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
        for (const permission of ALL_PERMISSIONS) {
          db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)', [roleId, permission]);
        }
      } else {
        for (const permission of role.permissions) {
          db.run('INSERT OR IGNORE INTO role_permissions (role_id, permission) VALUES (?, ?)', [roleId, permission]);
        }
      }
      void order;
    }
  });
}

export function resolvePermissions(db: Db, userId: number): { permissions: Set<Permission>; isAdministrator: boolean } {
  const rows = db.all<{ permission: string; role_code: string }>(
    `SELECT rp.permission AS permission, r.code AS role_code
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE ur.user_id = ?`,
    [userId],
  );
  const permissions = new Set<Permission>();
  let isAdministrator = false;
  for (const row of rows) {
    if (row.role_code === 'administrator') isAdministrator = true;
    if (row.permission) permissions.add(row.permission as Permission);
  }
  if (isAdministrator) for (const p of ALL_PERMISSIONS) permissions.add(p);
  return { permissions, isAdministrator };
}

export function hasPermission(actor: Actor | null, permission: Permission): boolean {
  if (!actor) return false;
  return actor.permissions.has(permission);
}

export function hasAnyPermission(actor: Actor | null, required: readonly Permission[]): boolean {
  if (!actor) return false;
  if (required.length === 0) return true;
  return required.some((p) => actor.permissions.has(p));
}

export function hasAllPermissions(actor: Actor | null, required: readonly Permission[]): boolean {
  if (!actor) return false;
  return required.every((p) => actor.permissions.has(p));
}

/**
 * Enforced at the service boundary, not in the UI. A hidden button is a
 * usability feature; this is the security control.
 */
export function requirePermission(actor: Actor | null, permission: Permission): void {
  if (!actor) throw permissionDenied('Your session has ended. Please sign in again.');
  if (!actor.permissions.has(permission)) {
    throw permissionDenied(`This action needs the "${PERMISSIONS[permission]}" permission.`);
  }
}

export function requireAnyPermission(actor: Actor | null, permissions: readonly Permission[]): void {
  if (!actor) throw permissionDenied('Your session has ended. Please sign in again.');
  if (!hasAnyPermission(actor, permissions)) {
    throw permissionDenied(`This action needs one of: ${permissions.map((p) => PERMISSIONS[p]).join(', ')}.`);
  }
}

export function requireAdminOnly(actor: Actor | null, permission: Permission): void {
  requirePermission(actor, permission);
  if (!actor) throw permissionDenied();
  if (ADMIN_ONLY_PERMISSIONS.includes(permission) && !actor.isAdministrator) {
    throw permissionDenied(`"${PERMISSIONS[permission]}" can only be performed by an Administrator.`);
  }
}

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isAdminRoleCode(code: string): code is RoleCode {
  return code === 'administrator';
}
