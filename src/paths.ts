/**
 * Path helpers that work the same on every platform.
 *
 * The analysis core must be pure and testable against an in-memory file
 * system, which rules out `node:path` — its behaviour changes with the host OS,
 * so a fixture that passes on Linux would fail on Windows for reasons that have
 * nothing to do with tsconfig. Everything here operates on forward-slash paths,
 * and {@link toPosix} is the single door through which host paths enter.
 */

/** Converts backslashes to forward slashes and collapses runs of separators. */
export function toPosix(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

/** True for `/unix`, `C:/windows` and `//unc/share` style absolute paths. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:\//.test(path);
}

/** The directory containing `path`, without a trailing slash (except at a root). */
export function dirname(path: string): string {
  const normalized = toPosix(path);
  const index = normalized.lastIndexOf('/');
  if (index < 0) return '.';
  if (index === 0) return '/';
  const head = normalized.slice(0, index);
  return /^[A-Za-z]:$/.test(head) ? `${head}/` : head;
}

/** The final segment of `path`. */
export function basename(path: string): string {
  const normalized = toPosix(path);
  const index = normalized.lastIndexOf('/');
  return index < 0 ? normalized : normalized.slice(index + 1);
}

/** Removes `.` and `..` segments without touching the file system. */
export function normalizePath(path: string): string {
  const normalized = toPosix(path);
  const driveMatch = /^([A-Za-z]:\/)/.exec(normalized);
  const prefix = driveMatch?.[1] ?? (normalized.startsWith('/') ? '/' : '');
  const body = normalized.slice(prefix.length);
  const out: string[] = [];
  for (const segment of body.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const last = out[out.length - 1];
      if (out.length > 0 && last !== '..') {
        out.pop();
        continue;
      }
      if (prefix !== '') continue; // cannot escape a root
    }
    out.push(segment);
  }
  const joined = out.join('/');
  if (prefix !== '') return prefix === '/' ? `/${joined}` : `${prefix}${joined}`;
  return joined === '' ? '.' : joined;
}

/** Joins segments and normalizes the result. */
export function joinPath(...segments: string[]): string {
  const parts = segments.filter((segment) => segment !== '');
  if (parts.length === 0) return '.';
  return normalizePath(parts.join('/'));
}

/** Resolves `path` against `base`, which is itself assumed absolute. */
export function resolvePath(base: string, path: string): string {
  if (isAbsolutePath(path)) return normalizePath(path);
  return normalizePath(`${toPosix(base)}/${path}`);
}

/**
 * A display path: relative to `from` when that reads better than the absolute
 * one, absolute otherwise. Only ever used for output, never for resolution.
 */
export function relativePath(from: string, to: string): string {
  const fromParts = normalizePath(toPosix(from)).split('/');
  const toParts = normalizePath(toPosix(to)).split('/');
  if (fromParts[0]?.toLowerCase() !== toParts[0]?.toLowerCase()) return toPosix(to);
  let common = 0;
  while (
    common < fromParts.length &&
    common < toParts.length &&
    fromParts[common] === toParts[common]
  ) {
    common += 1;
  }
  const up = fromParts.length - common;
  const parts = [...Array<string>(up).fill('..'), ...toParts.slice(common)];
  const joined = parts.join('/');
  return joined === '' ? '.' : joined;
}

/** True when `path` has a `.json`-ish extension, used by `extends` resolution. */
export function hasJsonExtension(path: string): boolean {
  return /\.json$/i.test(path);
}
