/**
 * Core data model. This module must stay free of `vscode` imports so it can be unit-tested.
 */

/**
 * Where a library is stored.
 *
 * - `user` — follows the person across every project they open on this machine.
 * - `workspace` — lives in the project, under `.vscode/`, and is meant to be committed.
 * - `remote` — a vault on a server, cached locally and synced. Same shape, same file format;
 *   where the bytes live is the only difference, which is what lets one set of editing code
 *   serve all three.
 */
export type Scope = 'user' | 'workspace' | 'remote';

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
  /**
   * Optional, unlike an item's.
   *
   * Groups predate sync and every `snippick.json` already written is without it, so a missing
   * value has to keep meaning "as old as anything" rather than failing validation. Sync sets it;
   * a hand-edited file need not.
   */
  updatedAt?: number;
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
