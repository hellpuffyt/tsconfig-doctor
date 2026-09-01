/**
 * The published version.
 *
 * Duplicating package.json here avoids importing JSON at runtime, which would
 * mean either an import attribute (still unstable across the Node versions this
 * package supports) or reading a file relative to `import.meta.url`. The
 * duplication is checked by a test that parses package.json, so the two cannot
 * drift.
 */
export const VERSION = '0.1.0';
