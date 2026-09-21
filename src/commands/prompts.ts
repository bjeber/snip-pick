import * as vscode from 'vscode';
import { groupPath } from '../model/normalize';
import { bodyPreview } from '../model/types';
import type { ItemRef, ScopeInfo, Store } from '../store/store';
import type { TreeNode } from '../ui/tree/nodes';

const NEW_GROUP = Symbol('new-group');

/** Tree menus hand us a `TreeNode`; the Quick Pick hands us an `ItemRef`. Accept both. */
export function toItemRef(arg: unknown): ItemRef | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const candidate = arg as Partial<TreeNode & ItemRef>;
  if ('kind' in candidate && candidate.kind === 'item' && candidate.scopeId && candidate.itemId) {
    return { scopeId: candidate.scopeId, itemId: candidate.itemId };
  }
  if (candidate.scopeId && candidate.itemId) {
    return { scopeId: candidate.scopeId, itemId: candidate.itemId };
  }
  return undefined;
}

export function toGroupRef(arg: unknown): { scopeId: string; groupId: string } | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const candidate = arg as Partial<TreeNode & { scopeId: string; groupId: string }>;
  if ('kind' in candidate && candidate.kind === 'group' && candidate.scopeId && candidate.groupId) {
    return { scopeId: candidate.scopeId, groupId: candidate.groupId };
  }
  return undefined;
}

export function toScopeId(arg: unknown): string | undefined {
  if (!arg || typeof arg !== 'object') return undefined;
  const candidate = arg as Partial<TreeNode & { scopeId: string }>;
  if ('kind' in candidate && (candidate.kind === 'scope' || candidate.kind === 'group')) {
    return candidate.scopeId;
  }
  return undefined;
}

/** Asks the user to pick an item, used when a command is invoked from the Command Palette. */
export async function pickItem(store: Store, title: string): Promise<ItemRef | undefined> {
  const entries = store.allItems().map(({ scopeId, item }) => ({
    label: `$(${item.type === 'snippet' ? 'symbol-snippet' : 'terminal'}) ${item.title}`,
    description: store.scope(scopeId)?.label,
    detail: bodyPreview(item),
    ref: { scopeId, itemId: item.id } satisfies ItemRef,
  }));
  if (entries.length === 0) {
    void vscode.window.showInformationMessage('Snip Pick: nothing saved yet.');
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(entries, { title, matchOnDetail: true });
  return picked?.ref;
}

/** Picks a writable scope. Skips the prompt when there is only one choice. */
export async function pickScope(
  store: Store,
  title: string,
  preferred?: string,
): Promise<ScopeInfo | undefined> {
  const writable = store.scopes().filter((scope) => !scope.readonly);
  if (writable.length === 0) {
    void vscode.window.showWarningMessage('Snip Pick: no writable scope in this workspace.');
    return undefined;
  }
  if (writable.length === 1) return writable[0];
  const preferredScope = preferred ? writable.find((scope) => scope.id === preferred) : undefined;
  const ordered = preferredScope
    ? [preferredScope, ...writable.filter((scope) => scope !== preferredScope)]
    : writable;
  const picked = await vscode.window.showQuickPick(
    ordered.map((scope) => ({
      label: scope.kind === 'global' ? '$(globe) Global' : `$(root-folder) ${scope.label}`,
      description: scope.fileUri.fsPath,
      scope,
    })),
    { title },
  );
  return picked?.scope;
}

/**
 * Picks a group inside `scopeId`, offering "(ungrouped)" and "New group…".
 * Returns `undefined` when cancelled, `{ groupId: undefined }` for ungrouped.
 */
export async function pickGroup(
  store: Store,
  scopeId: string,
  title: string,
): Promise<{ groupId: string | undefined } | undefined> {
  const groups = store.groups(scopeId);
  const entries: Array<vscode.QuickPickItem & { value: string | undefined | typeof NEW_GROUP }> = [
    { label: '$(dash) (ungrouped)', value: undefined },
    ...groups
      .map((group) => ({
        label: `$(folder) ${groupPath(groups, group.id)}`,
        value: group.id as string | undefined | typeof NEW_GROUP,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    { label: '$(new-folder) New group…', value: NEW_GROUP },
  ];
  const picked = await vscode.window.showQuickPick(entries, { title });
  if (!picked) return undefined;
  if (picked.value !== NEW_GROUP) return { groupId: picked.value as string | undefined };

  const name = await vscode.window.showInputBox({ title: 'New group', prompt: 'Group name' });
  if (!name?.trim()) return undefined;
  const group = await store.addGroup(scopeId, name.trim());
  return { groupId: group.id };
}
