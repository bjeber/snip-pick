import * as vscode from 'vscode';
import { groupPath } from '@snip-pick/core';
import { type Item } from '@snip-pick/contracts';
import type { ItemRef, Store } from '../../store/store';
import { renderEditorHtml } from './html';

interface SavePayload {
  title: string;
  type: 'snippet' | 'command';
  body: string;
  description: string;
  prefix: string;
  tags: string;
  groupId: string;
  languages: string;
  globs: string;
  markers: string;
  cwd: 'workspace' | 'fileDir';
  confirm: boolean;
  steps: string;
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toPatch(payload: SavePayload): Partial<Item> {
  const patch: Partial<Item> = {
    title: payload.title.trim() || 'Untitled',
    type: payload.type,
    body: payload.body,
    description: payload.description.trim() || undefined,
    prefix: payload.type === 'snippet' ? payload.prefix.trim() || undefined : undefined,
    tags: splitList(payload.tags),
    groupId: payload.groupId || undefined,
  };
  const languages = splitList(payload.languages);
  const globs = splitList(payload.globs);
  const markers = splitList(payload.markers);
  patch.context =
    languages.length || globs.length || markers.length
      ? {
          ...(languages.length ? { languages } : {}),
          ...(globs.length ? { globs } : {}),
          ...(markers.length ? { markers } : {}),
        }
      : undefined;
  if (payload.type === 'command') {
    patch.cwd = payload.cwd;
    patch.confirm = payload.confirm || undefined;
    const steps = splitLines(payload.steps);
    patch.steps = steps.length > 0 ? steps : undefined;
  } else {
    patch.cwd = undefined;
    patch.confirm = undefined;
    patch.steps = undefined;
  }
  return patch;
}

const panels = new Map<string, vscode.WebviewPanel>();

/** Opens (or reveals) the small edit form for one item. */
export function openItemEditor(context: vscode.ExtensionContext, store: Store, ref: ItemRef): void {
  const item = store.getItem(ref);
  if (!item) return;
  const key = `${ref.scopeId}:${ref.itemId}`;
  const existing = panels.get(key);
  if (existing) {
    existing.reveal(vscode.ViewColumn.Active);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'snipPick.editor',
    `Snip Pick: ${item.title}`,
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
  );
  panels.set(key, panel);

  const groups = store.groups(ref.scopeId).map((group) => ({
    id: group.id,
    label: groupPath(store.groups(ref.scopeId), group.id),
  }));
  panel.webview.html = renderEditorHtml(panel.webview, item, groups);

  const subscription = panel.webview.onDidReceiveMessage(async (message: unknown) => {
    const event = message as { type?: string; payload?: SavePayload };
    if (event.type === 'cancel') {
      panel.dispose();
      return;
    }
    if (event.type !== 'save' || !event.payload) return;
    try {
      await store.updateItem(ref, toPatch(event.payload));
      panel.dispose();
    } catch (error) {
      void vscode.window.showErrorMessage(`Snip Pick: ${(error as Error).message}`);
    }
  });

  panel.onDidDispose(
    () => {
      panels.delete(key);
      subscription.dispose();
    },
    undefined,
    context.subscriptions,
  );
}
