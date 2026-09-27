import { hostname } from 'node:os';
import type { Db } from '../db/connection';
import { nowIso } from '../db/connection';
import type { Actor } from '../security/rbac';

export type AuditResult = 'success' | 'failure';

export interface AuditInput {
  action: string;
  entity?: string;
  entityId?: string | number | null;
  result?: AuditResult;
  summary?: string;
  metadata?: Record<string, unknown>;
}

const SENSITIVE_KEY = /(pass(word)?|passcode|activation|secret|token|hash|code)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[deep]';
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

let machineName = '';
try {
  machineName = hostname();
} catch {
  machineName = 'unknown';
}

/**
 * Writes the audit record. When called inside a service transaction the caller
 * passes `db` and the row is committed together with the change, so the audit
 * trail can never diverge from the data.
 */
export function writeAudit(db: Db, actor: Actor | null, input: AuditInput): void {
  const metadata = input.metadata ? JSON.stringify(redact(input.metadata)) : '{}';
  db.run(
    `INSERT INTO audit_logs (at, user_id, username, action, entity, entity_id, result, summary, metadata, machine, session_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nowIso(),
      actor?.userId ?? null,
      actor?.username ?? '',
      input.action,
      input.entity ?? '',
      input.entityId === null || input.entityId === undefined ? '' : String(input.entityId),
      input.result ?? 'success',
      (input.summary ?? '').slice(0, 500),
      metadata,
      machineName,
      actor?.sessionId ?? '',
    ],
  );
}
