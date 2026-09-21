import * as vscode from 'vscode';
import { newId } from '../model/ids';
import type { Item } from '../model/types';
import type { DiscoveryItemNode } from '../ui/tree/nodes';
import { guard } from './itemCommands';
import { pickGroup, pickScope } from './prompts';
import type { Services } from './services';

function isDiscoveryItem(arg: unknown): arg is DiscoveryItemNode {
  return (
    typeof arg === 'object' && arg !== null && (arg as { kind?: string }).kind === 'discoveryItem'
  );
}

export function registerDiscoveryCommands(services: Services): vscode.Disposable[] {
  const { store, runner } = services;

  return [
    vscode.commands.registerCommand('snipPick.runDiscovered', async (arg: unknown) => {
      if (!isDiscoveryItem(arg)) return;
      const folder = (vscode.workspace.workspaceFolders ?? []).find(
        (entry) => entry.uri.toString() === arg.folderUri,
      );
      await guard(() => runner.runAdHoc(arg.task.name, arg.task.command, folder));
    }),

    vscode.commands.registerCommand('snipPick.copyDiscovered', async (arg: unknown) => {
      if (!isDiscoveryItem(arg)) return;
      const scope = await pickScope(store, 'Copy to which scope?', store.defaultScopeId());
      if (!scope) return;
      const group = await pickGroup(store, scope.id, 'Copy into which group?');
      if (!group) return;
      const now = Date.now();
      const item: Item = {
        id: newId(),
        type: 'command',
        title: arg.task.name,
        body: arg.task.command,
        tags: [arg.source],
        cwd: 'workspace',
        createdAt: now,
        updatedAt: now,
      };
      if (arg.task.detail) item.description = arg.task.detail;
      if (group.groupId !== undefined) item.groupId = group.groupId;
      await guard(async () => {
        await store.addItem(scope.id, item);
        void vscode.window.showInformationMessage(`Snip Pick: saved "${item.title}".`);
      });
    }),
  ];
}
