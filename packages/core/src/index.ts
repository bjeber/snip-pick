/**
 * Everything both the VS Code extension and the API need to agree on.
 *
 * This package must stay free of `vscode` and of any server-only dependency: it is the shared
 * contract between the two, and the only reason its logic can be unit-tested without an editor
 * or a database. The lint config enforces the `vscode` half of that.
 */

export * from './model/types';
export * from './model/schema';
export * from './model/normalize';
export * from './model/jsonc';
export * from './model/ids';

export * from './context/relevance';
export * from './context/frecency';
export * from './context/ordering';

export * from './runner/variables';
export * from './runner/danger';

export * from './store/merge';
export * from './store/usage';

export * from './discovery/parsers';

export * from './importers/codeSnippets';

export * from './api/contracts';
