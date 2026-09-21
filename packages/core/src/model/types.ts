/**
 * Core data model. This module must stay free of `vscode` imports so it can be unit-tested.
 */

/**
 * Where a library is stored.
 *
 * - `user` — follows the person across every project they open on this machine.
 * - `workspace` — lives in the project, under `.vscode/`, and is meant to be committed.
 */
export type Scope = 'user' | 'workspace';

export type ItemType = 'snippet' | 'command';

export type Cwd = 'workspace' | 'fileDir';

export interface ItemContext {
  /** VS Code languageIds, e.g. `typescript`. */
  languages?: string[];
  /** Globs matched against the workspace-relative path, e.g. `**\/*.test.ts`. */
  globs?: string[];
  /** Files at the workspace folder root, e.g. `package.json`. */
  markers?: string[];
}

export interface Group {
  id: string;
  name: string;
  parentId?: string;
  order: number;
}

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  body: string;
  description?: string;
  /** Snippets: trigger for IntelliSense. */
  prefix?: string;
  /** `undefined` means ungrouped. */
  groupId?: string;
  tags: string[];
  context?: ItemContext;
  /** Commands only, default `workspace`. */
  cwd?: Cwd;
  /** Commands only; ask before running. */
  confirm?: boolean;
  /** Commands only; a command chain. When set, `body` is ignored. */
  steps?: string[];
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
}

export const CURRENT_SCHEMA_VERSION = 1;

export interface SnipPickFile {
  schemaVersion: 1;
  groups: Group[];
  items: Item[];
}

export interface UsageEntry {
  uses: number;
  lastUsed: number;
}

export interface Usage {
  [itemId: string]: UsageEntry;
}

export function emptyFile(): SnipPickFile {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, groups: [], items: [] };
}

/** The command text that will actually be sent to a terminal. */
export function commandText(item: Pick<Item, 'body' | 'steps'>): string {
  if (item.steps && item.steps.length > 0) {
    return item.steps.join(' && ');
  }
  return item.body;
}

/** A single-line preview of an item's body, for list details and tooltips. */
export function bodyPreview(item: Pick<Item, 'body' | 'steps'>, maxLength = 120): string {
  const raw = commandText(item).replace(/\s+/g, ' ').trim();
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1)}…` : raw;
}
