import type { Permission } from '../shared/permissions';
import type { Container } from './container';
import type { Actor } from './security/rbac';
import { AppError, permissionDenied, unauthenticated } from './errors';

export interface OpContext {
  c: Container;
  actor: Actor | null;
  now: Date;
}

export interface OpSpec<I = unknown, O = unknown> {
  /** Permissions required to call this operation. All of them. Enforced server-side. */
  perms?: Permission[];
  /** Alternative permissions; holding at least one is enough. Used where several roles may run the same op. */
  permsAny?: Permission[];
  /**
   * Input-dependent permission check, for operations whose required permission
   * varies with the payload (for example exporting a different dataset).
   * Runs at the service boundary, never in the UI.
   */
  guard?: (ctx: OpContext, input: I) => void;
  /** Callable without an authenticated session (login, activation, setup). */
  public?: boolean;
  /** Human label used in the audit trail and by the UI. */
  label?: string;
  handler: (ctx: OpContext, input: I) => O | Promise<O>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The spec is a structural description of the RPC surface; each operation's real
// input/output types are enforced where the operation is defined.
export type AnyOpSpec = OpSpec<any, any>;
export type ApiSpec = { [K: string]: AnyOpSpec | ApiSpec };

export interface RegisteredOp {
  name: string;
  perms: Permission[];
  permsAny: Permission[];
  guard?: (ctx: OpContext, input: never) => void;
  public: boolean;
  label: string;
  handler: (ctx: OpContext, input: never) => unknown;
}

export type Registry = Map<string, RegisteredOp>;

function isOpSpec(value: unknown): value is AnyOpSpec {
  return typeof value === 'object' && value !== null && typeof (value as OpSpec).handler === 'function';
}

export function buildRegistry(spec: ApiSpec): Registry {
  const registry: Registry = new Map();
  const walk = (node: ApiSpec, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (isOpSpec(value)) {
        if (registry.has(name)) throw new Error(`Duplicate operation name: ${name}`);
        registry.set(name, {
          name,
          perms: value.perms ?? [],
          permsAny: value.permsAny ?? [],
          guard: value.guard as RegisteredOp['guard'],
          public: value.public ?? false,
          label: value.label ?? name,
          handler: value.handler as RegisteredOp['handler'],
        });
      } else {
        walk(value as ApiSpec, name);
      }
    }
  };
  walk(spec, '');
  return registry;
}

export interface InvokeOptions {
  sessionToken?: string | null;
  machine?: string;
}

/**
 * The only operations a user may run while a forced password change is
 * outstanding. Everything here is either needed to finish signing in or is
 * harmless in itself.
 */
const PASSWORD_CHANGE_ALLOWLIST = new Set<string>([
  'auth.changePassword',
  'auth.me',
  'auth.logout',
  'auth.lock',
  'notifications.list',
  'settings.get',
  'system.status',
]);

export async function invokeOperation(
  registry: Registry,
  container: Container,
  opName: string,
  input: unknown,
  options: InvokeOptions = {},
): Promise<unknown> {
  const op = registry.get(opName);
  if (!op) throw new AppError('not_found', `Unknown operation "${opName}".`);

  const actor = options.sessionToken ? container.resolveActor(options.sessionToken) : null;

  if (!op.public) {
    if (!actor) throw unauthenticated();
    for (const perm of op.perms) {
      if (!actor.permissions.has(perm)) {
        throw permissionDenied(`This action needs the "${perm}" permission.`);
      }
    }
    if (op.permsAny.length > 0 && !op.permsAny.some((perm) => actor.permissions.has(perm))) {
      throw permissionDenied(`This action needs one of: ${op.permsAny.join(', ')}.`);
    }
    // A password an administrator had to reset must be replaced before the
    // account can touch real data. This is enforced in the core, not in the UI.
    if (actor.mustChangePassword && !PASSWORD_CHANGE_ALLOWLIST.has(opName)) {
      throw new AppError(
        'password_change_required',
        'Choose a new password before continuing.',
      );
    }
  }

  container.touchSession(options.sessionToken ?? null);
  if (op.guard) op.guard({ c: container, actor, now: new Date() }, (input ?? {}) as never);
  return op.handler({ c: container, actor, now: new Date() }, (input ?? {}) as never);
}
