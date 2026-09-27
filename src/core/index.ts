import { Container, type ContainerOptions } from './container';
import { getRegistry } from './api';
import { invokeOperation, type InvokeOptions } from './registry';
import { serialiseError, type SerialisedError } from './errors';

export interface InvokeResult {
  ok: boolean;
  data?: unknown;
  error?: SerialisedError;
}

/**
 * The single entry point every transport uses.
 *
 * Electron IPC and the local development/preview HTTP server both call this —
 * so the behaviour that is tested is exactly the behaviour that ships.
 */
export class DentivaApp {
  readonly container: Container;

  constructor(options: ContainerOptions = {}) {
    this.container = new Container(options);
  }

  async invoke(op: string, input: unknown, options: InvokeOptions = {}): Promise<InvokeResult> {
    try {
      const data = await invokeOperation(getRegistry(), this.container, op, input, options);
      return { ok: true, data };
    } catch (error) {
      const serialised = serialiseError(error);
      this.container.logger.warn('operation.failed', { op, code: serialised.code, message: serialised.message });
      return { ok: false, error: serialised };
    }
  }

  get dataRoot(): string {
    return this.container.paths.root;
  }

  close(): void {
    this.container.close();
  }
}

export { Container };
export * from './errors';
export { getLogger, setLogger, Logger } from './log/logger';
export { formatMoney, parseMoneyInput, formatQuantity, type Poisha } from './money/money';
export { APP, PAPER_SIZES, TOOTH_CONDITIONS, type PaperSizeId } from '../shared/constants';
export { ALL_PERMISSIONS, PERMISSIONS, PERMISSION_GROUPS, type Permission } from '../shared/permissions';
export { operationCatalogue } from './api';
export { BackupService, type BackupManifest } from './services/backup';
export { computeInvoice, refreshInvoiceTotals, invoiceStatusFor } from './api/financial';
export { toCsv } from './api/platform';
export { hashPassword, verifyPassword, checkPasswordPolicy } from './security/password';
export { verifyActivationCode } from './security/activation';
export { SCHEMA_SQL } from './db/schema';
export { runMigrations, MIGRATIONS, checksumOf } from './db/migrations';
