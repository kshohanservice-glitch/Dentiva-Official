import { getBridge } from '../bridge';
import type { InvokeEnvelope } from '../bridge';

export class ApiError extends Error {
  readonly code: string;
  readonly issues: { field: string; message: string }[];
  readonly detail?: string;

  constructor(envelope: NonNullable<InvokeEnvelope['error']>) {
    super(envelope.message);
    this.name = 'ApiError';
    this.code = envelope.code;
    this.issues = envelope.issues ?? [];
    this.detail = envelope.detail;
  }

  fieldError(field: string): string | undefined {
    return this.issues.find((issue) => issue.field === field || issue.field.endsWith(`.${field}`))?.message;
  }

  get isAuth(): boolean {
    return this.code === 'unauthenticated' || this.code === 'session_expired';
  }

  get isPermission(): boolean {
    return this.code === 'permission_denied';
  }
}

let tokenProvider: () => string | null = () => null;
let onAuthLost: () => void = () => {};

export function configureApi(options: { getToken: () => string | null; onAuthLost: () => void }): void {
  tokenProvider = options.getToken;
  onAuthLost = options.onAuthLost;
}

/**
 * The single call site from the UI into the application.
 * It unwraps the transport envelope, turns failures into `ApiError`, and
 * surfaces an expired session exactly once.
 */
export async function call<T = unknown>(op: string, input: unknown = {}): Promise<T> {
  const bridge = getBridge();
  let envelope: InvokeEnvelope<T>;
  try {
    envelope = await bridge.invoke<T>(op, input, tokenProvider());
  } catch (error) {
    throw new ApiError({
      code: 'internal',
      message: error instanceof Error ? error.message : 'The application could not reach its data service.',
      issues: [],
    });
  }
  if (!envelope.ok) {
    const error = new ApiError(envelope.error ?? { code: 'internal', message: 'Unknown error', issues: [] });
    if (error.isAuth) onAuthLost();
    throw error;
  }
  return envelope.data as T;
}

export function printBridge() {
  return getBridge().printing;
}
export function filesBridge() {
  return getBridge().files;
}
export function hostBridge() {
  return getBridge();
}
