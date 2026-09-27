/**
 * Typed error taxonomy.
 *
 * Every failure the user can see is an `AppError` with a stable machine code and
 * a message written for a clinic receptionist — never a stack trace, never a
 * file path, never a secret.
 */

export type ErrorCode =
  | 'validation'
  | 'not_found'
  | 'conflict'
  | 'permission_denied'
  | 'unauthenticated'
  | 'locked_out'
  | 'session_expired'
  | 'not_activated'
  | 'already_activated'
  | 'not_configured'
  | 'password_change_required'
  | 'business_rule'
  | 'io_error'
  | 'storage_full'
  | 'database_error'
  | 'print_error'
  | 'backup_error'
  | 'restore_error'
  | 'internal';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  validation: 400,
  not_found: 404,
  conflict: 409,
  permission_denied: 403,
  unauthenticated: 401,
  locked_out: 423,
  session_expired: 401,
  not_activated: 402,
  already_activated: 409,
  not_configured: 409,
  password_change_required: 403,
  business_rule: 422,
  io_error: 500,
  storage_full: 507,
  database_error: 500,
  print_error: 500,
  backup_error: 500,
  restore_error: 500,
  internal: 500,
};

export interface FieldIssue {
  field: string;
  message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues: FieldIssue[];
  readonly detail?: string;

  constructor(code: ErrorCode, message: string, opts: { issues?: FieldIssue[]; detail?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.issues = opts.issues ?? [];
    this.detail = opts.detail;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export const validationError = (message: string, issues: FieldIssue[] = []): AppError =>
  new AppError('validation', message, { issues });
export const fieldError = (issues: FieldIssue[], message = 'Please correct the highlighted fields.'): AppError =>
  new AppError('validation', message, { issues });
export const notFound = (what: string): AppError => new AppError('not_found', `${what} was not found.`);
export const conflict = (message: string): AppError => new AppError('conflict', message);
export const permissionDenied = (message = 'You do not have permission to perform this action.'): AppError =>
  new AppError('permission_denied', message);
export const unauthenticated = (message = 'Please sign in to continue.'): AppError =>
  new AppError('unauthenticated', message);
export const businessRule = (message: string): AppError => new AppError('business_rule', message);
export const internal = (message: string, detail?: string): AppError =>
  new AppError('internal', message, { detail });

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function errorCodeOf(value: unknown): ErrorCode {
  return isAppError(value) ? value.code : 'internal';
}

/** Shape sent to the renderer. Never contains a stack trace. */
export interface SerialisedError {
  code: ErrorCode;
  message: string;
  issues: FieldIssue[];
  detail?: string;
}

export function serialiseError(value: unknown): SerialisedError {
  if (isAppError(value)) {
    return { code: value.code, message: value.message, issues: value.issues, detail: value.detail };
  }
  if (value instanceof RangeError) {
    return { code: 'validation', message: value.message, issues: [] };
  }
  if (value instanceof Error) {
    // Unknown errors: generic message for the user, technical detail kept server-side.
    return { code: 'internal', message: 'Something went wrong. The operation was not completed.', issues: [], detail: value.message };
  }
  return { code: 'internal', message: 'Something went wrong. The operation was not completed.', issues: [] };
}
