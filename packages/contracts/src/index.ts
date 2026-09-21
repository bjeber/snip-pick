/**
 * The contract between the editor, the sync client and the server.
 *
 * This package is the bottom of the dependency graph: it has no runtime dependencies and reaches
 * for no platform API — not `vscode`, not `node:`, not a database driver. That is what lets the
 * extension and the API compile against one definition of a snippet instead of two that drift.
 *
 * Only shapes and their validation belong here. Behaviour over those shapes lives in
 * `@snip-pick/core` (editor-side) or in a server package.
 */

export * from './types';
export * from './schema';
export * from './vault';
