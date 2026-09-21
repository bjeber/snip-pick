import * as vscode from 'vscode';
import { newId } from '@snip-pick/core';
import { type Item } from '@snip-pick/contracts';
import { openItemEditor } from '../ui/editor/editorPanel';
import { guard } from './itemCommands';
import { pickGroup, pickScope, toGroupRef, toScopeId } from './prompts';
import type { Services } from './services';

interface Target {
  scopeId: string;
  groupId: string | undefined;
}

/**
 * Works out where a new item goes. Invoked from a tree node we use that node's scope and group;
 * from the palette we ask.
 */
async function resolveTarget(
  services: Services,
  arg: unknown,
  title: string,
): Promise<Target | undefined> {
  const group = toGroupRef(arg);
  if (group && !services.store.scope(group.scopeId)?.readonly) {
    return { scopeId: group.scopeId, groupId: group.groupId };
  }
  const scopeFromNode = toScopeId(arg);
  const scope =
    scopeFromNode && !services.store.scope(scopeFromNode)?.readonly
      ? services.store.scope(scopeFromNode)
      : await pickScope(services.store, `${title} — scope`, services.store.defaultScopeId());
  if (!scope) return undefined;
  const picked = await pickGroup(services.store, scope.id, `${title} — group`);
  if (!picked) return undefined;
  return { scopeId: scope.id, groupId: picked.groupId };
}

function firstLine(text: string, max = 60): string {
  const line =
    text
      .split('\n')
      .find((entry) => entry.trim().length > 0)
      ?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

async function createSnippet(services: Services, arg: unknown, body: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const title = await vscode.window.showInputBox({
    title: 'New snippet',
    prompt: 'Title',
    value: firstLine(body),
    validateInput: (value) => (value.trim().length === 0 ? 'A title is required' : undefined),
  });
  if (title === undefined) return;
  const target = await resolveTarget(services, arg, 'New snippet');
  if (!target) return;

  const now = Date.now();
  const item: Item = {
    id: newId(),
    type: 'snippet',
    title: title.trim(),
    body,
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
  if (target.groupId !== undefined) item.groupId = target.groupId;
  // Auto-fill the language from the editor the snippet came from; the user can clear it.
  if (editor && body.length > 0) item.context = { languages: [editor.document.languageId] };

  await guard(async () => {
    await services.store.addItem(target.scopeId, item);
    services.treeView
      .reveal(
        { kind: 'item', scopeId: target.scopeId, itemId: item.id },
        { select: true, focus: false },
      )
      .then(undefined, () => undefined);
    if (body.length === 0)
      openItemEditor(services.context, services.store, {
        scopeId: target.scopeId,
        itemId: item.id,
      });
  });
}

export async function createCommandItem(
  services: Services,
  arg: unknown,
  presetBody?: string,
): Promise<void> {
  const body =
    presetBody ??
    (await vscode.window.showInputBox({
      title: 'New command',
      prompt: 'Shell command',
      placeHolder: 'npm run build -- --filter {{package}}',
      validateInput: (value) => (value.trim().length === 0 ? 'A command is required' : undefined),
    }));
  if (body === undefined) return;

  const title = await vscode.window.showInputBox({
    title: 'New command',
    prompt: 'Title',
    value: firstLine(body),
    validateInput: (value) => (value.trim().length === 0 ? 'A title is required' : undefined),
  });
  if (title === undefined) return;

  const target = await resolveTarget(services, arg, 'New command');
  if (!target) return;

  const now = Date.now();
  const item: Item = {
    id: newId(),
    type: 'command',
    title: title.trim(),
    body: body.trim(),
    tags: [],
    cwd: 'workspace',
    createdAt: now,
    updatedAt: now,
  };
  if (target.groupId !== undefined) item.groupId = target.groupId;
  await guard(async () => {
    await services.store.addItem(target.scopeId, item);
  });
}

export function registerCreateCommands(services: Services): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('snipPick.addSnippet', async (arg: unknown) => {
      const editor = vscode.window.activeTextEditor;
      const body =
        editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
      await createSnippet(services, arg, body);
    }),

    vscode.commands.registerCommand('snipPick.addSnippetFromSelection', async (arg: unknown) => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.selection.isEmpty) {
        void vscode.window.showWarningMessage('Snip Pick: select some code first.');
        return;
      }
      await createSnippet(services, arg, editor.document.getText(editor.selection));
    }),

    vscode.commands.registerCommand('snipPick.addCommand', async (arg: unknown) => {
      await createCommandItem(services, arg);
    }),

    vscode.commands.registerCommand('snipPick.newGroup', async (arg: unknown) => {
      const group = toGroupRef(arg);
      const scopeId = group?.scopeId ?? toScopeId(arg);
      const scope =
        scopeId && !services.store.scope(scopeId)?.readonly
          ? services.store.scope(scopeId)
          : await pickScope(services.store, 'New group — scope', services.store.defaultScopeId());
      if (!scope) return;
      const name = await vscode.window.showInputBox({
        title: 'New group',
        prompt: group
          ? `Name (inside "${services.store.getGroup(scope.id, group.groupId)?.name}")`
          : 'Name',
        validateInput: (value) => (value.trim().length === 0 ? 'A name is required' : undefined),
      });
      if (!name) return;
      await guard(async () => {
        await services.store.addGroup(scope.id, name.trim(), group?.groupId);
      });
    }),
  ];
}
