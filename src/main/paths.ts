import { join } from 'node:path';

/**
 * Where the built application lives on disk.
 *
 * The compiler emits `out/src/main/*.js` and the renderer bundle goes to
 * `dist/renderer/`, so from a compiled main file the application root is three
 * levels up. These helpers keep that arithmetic in one place: when the build
 * layout changes, it changes here and not in six call sites.
 */

export const APP_ROOT = join(__dirname, '..', '..', '..');
export const RENDERER_HTML = join(APP_ROOT, 'dist', 'renderer', 'index.html');
export const PRELOAD = join(__dirname, 'preload.cjs');
export const APP_ICON = join(APP_ROOT, 'build', 'icon.ico');
