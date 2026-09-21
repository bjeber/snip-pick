/**
 * Snippet behaviour the editor needs: ranking, variable expansion, danger detection, merging,
 * discovery and import.
 *
 * The shapes this operates on live in `@snip-pick/contracts`; consumers import them from there
 * rather than through this package, so a module's dependencies stay visible at its import site.
 *
 * This package must stay free of `vscode` and of any server-only dependency: it is what lets the
 * logic be unit-tested without an editor. The lint config enforces both halves of that.
 */

export * from './model/normalize';
export * from './model/jsonc';
export * from './model/ids';

export * from './context/relevance';
export * from './context/frecency';
export * from './context/ordering';

export * from './runner/variables';
export * from './runner/danger';

export * from './store/merge';
export * from './store/sync';
export * from './store/usage';

export * from './discovery/parsers';

export * from './importers/codeSnippets';
