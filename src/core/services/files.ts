import { mkdirSync, writeFileSync, renameSync, existsSync, statSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { AppError, notFound } from '../errors';
import { nowIso } from '../db/connection';
import { MAX_ATTACHMENT_BYTES, ATTACHMENT_MIME_EXTENSIONS } from '../../shared/constants';

/** Magic-byte sniffing so an executable renamed to .jpg can never be stored. */
const SIGNATURES: { mime: string; bytes: number[]; offset?: number }[] = [
  { mime: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'application/pdf', bytes: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/bmp', bytes: [0x42, 0x4d] },
];

export function sniffMime(buffer: Buffer): string | null {
  for (const sig of SIGNATURES) {
    const offset = sig.offset ?? 0;
    if (buffer.length < offset + sig.bytes.length) continue;
    let ok = true;
    for (let i = 0; i < sig.bytes.length; i += 1) {
      if (buffer[offset + i] !== sig.bytes[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return sig.mime;
  }
  // WEBP: "RIFF" .... "WEBP"
  if (buffer.length > 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') {
    return 'image/webp';
  }
  // Plain text has no magic bytes, so it is recognised by what it is *not*:
  // valid UTF-8 with no NUL and no unexpected control characters. An executable
  // renamed to .txt still fails this test.
  if (looksLikeUtf8Text(buffer)) return 'text/plain';
  return null;
}

/** True when the whole buffer is well-formed printable UTF-8 text. */
function looksLikeUtf8Text(buffer: Buffer): boolean {
  let hasVisible = false;
  for (let i = 0; i < buffer.length; i += 1) {
    const byte = buffer[i] as number;
    if (byte === 0x09 || byte === 0x0a || byte === 0x0d) continue;
    if (byte < 0x20 || byte === 0x7f) return false;
    hasVisible = true;
  }
  if (!hasVisible) return false;
  const text = buffer.toString('utf8');
  // A lossy round-trip means the input was not valid UTF-8 to begin with.
  return Buffer.from(text, 'utf8').equals(buffer);
}

export function isSupportedMime(mime: string): boolean {
  return mime in ATTACHMENT_MIME_EXTENSIONS;
}

export function safeFileName(name: string): string {
  const base = name.replace(/[\\/]+/g, '_').replace(/[\u0000-\u001f<>:"|?*]/g, '_').replace(/\s+/g, ' ').trim();
  const cleaned = base.replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'file';
}

/**
 * Every application-managed path must resolve inside its root. This is the
 * single containment primitive used by attachments, backups and exports.
 *
 * Segments may contain sub-directories (attachments are filed under a year),
 * but `.` and `..` are rejected outright and the result is still checked to be
 * inside the root, so no combination can escape.
 */
export function resolveWithin(root: string, ...segments: string[]): string {
  const rootAbs = resolve(root);
  const parts: string[] = [];
  for (const segment of segments) {
    for (const piece of segment.split(/[\\/]+/)) {
      if (piece === '' || piece === '.') continue;
      if (piece === '..') throw new AppError('io_error', 'The requested file location is not valid.');
      parts.push(piece);
    }
  }
  const target = resolve(rootAbs, ...parts);
  if (target !== rootAbs && !target.startsWith(rootAbs + sep)) {
    throw new AppError('io_error', 'The requested file location is not valid.');
  }
  return target;
}

/**
 * Rejects a client-supplied file name that tries to steer the write. The name
 * is only ever used for display and for choosing the extension, but silently
 * rewriting what the user picked is worse than saying so.
 */
export function assertPlainFileName(name: string): string {
  if (/[\\/]/.test(name) || name.includes('..') || /[\u0000-\u001f]/.test(name)) {
    throw new AppError('validation', 'The file name must not contain folder separators.');
  }
  return name;
}

export interface StoredFile {
  storedName: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
}

export function storeAttachmentFile(vaultDir: string, data: Buffer, declaredMime?: string): StoredFile {
  if (data.length === 0) throw new AppError('validation', 'The selected file is empty.');
  if (data.length > MAX_ATTACHMENT_BYTES) {
    throw new AppError('validation', `The file is too large. The maximum supported size is ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB.`);
  }
  const detected = sniffMime(data);
  if (!detected || !isSupportedMime(detected)) {
    throw new AppError('validation', 'That file type is not supported. Allowed types: JPG, PNG, GIF, WEBP, BMP, PDF and TXT.');
  }
  if (declaredMime && declaredMime !== 'application/octet-stream' && declaredMime !== detected) {
    throw new AppError('validation', 'The file contents do not match its type. The file was not saved.');
  }
  const sub = join(vaultDir, String(new Date().getFullYear()));
  mkdirSync(sub, { recursive: true });
  const storedName = `${randomUUID()}${ATTACHMENT_MIME_EXTENSIONS[detected] as string}`;
  const path = resolveWithin(sub, storedName);
  writeFileSync(path, data);
  return {
    storedName: `${new Date().getFullYear()}/${storedName}`,
    byteSize: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
    mimeType: detected,
  };
}

export function readAttachmentFile(vaultDir: string, storedName: string): Buffer {
  const path = resolveWithin(vaultDir, storedName);
  if (!existsSync(path)) throw notFound('The attachment file');
  return readFileSync(path);
}

export function attachmentPath(vaultDir: string, storedName: string): string {
  const path = resolveWithin(vaultDir, storedName);
  if (!existsSync(path)) throw notFound('The attachment file');
  return path;
}

export function deleteAttachmentFile(vaultDir: string, storedName: string): void {
  const path = resolveWithin(vaultDir, storedName);
  if (existsSync(path)) rmSync(path, { force: true });
}

export function vaultUsage(vaultDir: string): { bytes: number; files: number } {
  let bytes = 0;
  let files = 0;
  const walk = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        try {
          bytes += statSync(full).size;
          files += 1;
        } catch {
          /* file vanished between readdir and stat — ignore */
        }
      }
    }
  };
  walk(vaultDir);
  return { bytes, files };
}

export function writeFileAtomic(path: string, data: Buffer | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function timestampSlug(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}_${p(date.getHours())}-${p(date.getMinutes())}-${p(date.getSeconds())}`;
}

export function isoNow(): string {
  return nowIso();
}
