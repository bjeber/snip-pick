import * as vscode from 'vscode';
import { newId } from '../model/ids';
import type { Item } from '../model/types';
import type { ItemRef } from '../store/store';
import { openItemEditor } from '../ui/editor/editorPanel';
import type { Services } from './services';
import { pickGroup, pickItem, toItemRef } from './prompts';

/** Surfaces store errors (read-only scopes, broken files) as notifications instead of crashes. */
export async function guard(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    void vscode.window.showErrorMessage(`Snip Pick: ${(error as Error).message}`);
  }
}

async function resolve(
  services: Services,
  arg: unknown,
  title: string,
): Promise<ItemRef | undefined> {
  return toItemRef(arg) ?? (await pickItem(services.store, title));
}

export function registerItemCommands(services: Services): vscode.Disposable[] {
  const { store, runner, context } = services;

  return [
    vscode.commands.registerCommand('snipPick.activate', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Insert or run');
      if (ref) await guard(() => runner.activate(ref));
    }),

    vscode.commands.registerCommand('snipPick.insert', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Insert snippet');
      if (ref) await guard(() => runner.insert(ref));
    }),

    vscode.commands.registerCommand('snipPick.run', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Run command');
      if (ref) await guard(() => runner.run(ref));
    }),

    vscode.commands.registerCommand('snipPick.copy', async (arg: unknown) => {
      if (isDiscoveryNode(arg)) {
        await vscode.env.clipboard.writeText(arg.task.command);
        void vscode.window.setStatusBarMessage(`Snip Pick: copied "${arg.task.name}"`, 3000);
        return;
      }
      const ref = await resolve(services, arg, 'Copy to clipboard');
      if (ref) await guard(() => runner.copy(ref));
    }),

    vscode.commands.registerCommand('snipPick.edit', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Edit');
      if (!ref) return;
      if (store.scope(ref.scopeId)?.readonly) {
        void vscode.window.showWarningMessage('Snip Pick: this item is read-only.');
        return;
      }
      openItemEditor(context, store, ref);
    }),

    vscode.commands.registerCommand('snipPick.editAsJson', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Edit as JSON');
      if (!ref) return;
      await guard(async () => {
        const uri = await store.ensureFile(ref.scopeId);
        const document = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(document);
        const offset = document.getText().indexOf(`"id": "${ref.itemId}"`);
        if (offset >= 0) {
          const position = document.positionAt(offset);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter,
          );
        }
      });
    }),

    vscode.commands.registerCommand('snipPick.delete', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Delete');
      if (!ref) return;
      const item = store.getItem(ref);
      if (!item) return;
      const choice = await vscode.window.showWarningMessage(
        `Delete "${item.title}"?`,
        { modal: true },
        'Delete',
      );
      if (choice !== 'Delete') return;
      await guard(() => store.deleteItem(ref));
    }),

    vscode.commands.registerCommand('snipPick.togglePin', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Pin / unpin');
      if (!ref) return;
      const item = store.getItem(ref);
      if (!item) return;
      await guard(() => store.updateItem(ref, { pinned: item.pinned ? undefined : true }));
    }),

    vscode.commands.registerCommand('snipPick.duplicate', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Duplicate');
      if (!ref) return;
      const item = store.getItem(ref);
      if (!item) return;
      const now = Date.now();
      const copy: Item = {
        ...item,
        id: newId(),
        title: `${item.title} (copy)`,
        createdAt: now,
        updatedAt: now,
      };
      const target = store.scope(ref.scopeId)?.readonly ? store.defaultScopeId() : ref.scopeId;
      if (target !== ref.scopeId) delete copy.groupId;
      await guard(() => store.addItem(target, copy).then(() => undefined));
    }),

    vscode.commands.registerCommand('snipPick.moveToGroup', async (arg: unknown) => {
      const ref = await resolve(services, arg, 'Move to group');
      if (!ref) return;
      const choice = await pickGroup(store, ref.scopeId, 'Move to group');
      if (!choice) return;
      await guard(() => store.moveItem(ref, ref.scopeId, choice.groupId));
    }),
  ];
}

function isDiscoveryNode(
  arg: unknown,
): arg is { kind: 'discoveryItem'; task: { name: string; command: string } } {
  return (
    typeof arg === 'object' && arg !== null && (arg as { kind?: string }).kind === 'discoveryItem'
  );
}
