import * as vscode from 'vscode';
import { descendantGroupIds } from '../model/normalize';
import { guard } from './itemCommands';
import { toGroupRef } from './prompts';
import type { Services } from './services';

export function registerGroupCommands(services: Services): vscode.Disposable[] {
  const { store } = services;

  return [
    vscode.commands.registerCommand('snipPick.renameGroup', async (arg: unknown) => {
      const ref = toGroupRef(arg);
      if (!ref) return;
      const group = store.getGroup(ref.scopeId, ref.groupId);
      if (!group) return;
      const name = await vscode.window.showInputBox({
        title: 'Rename group',
        value: group.name,
        validateInput: (value) => (value.trim().length === 0 ? 'A name is required' : undefined),
      });
      if (!name) return;
      await guard(() => store.renameGroup(ref.scopeId, ref.groupId, name.trim()));
    }),

    vscode.commands.registerCommand('snipPick.deleteGroup', async (arg: unknown) => {
      const ref = toGroupRef(arg);
      if (!ref) return;
      const group = store.getGroup(ref.scopeId, ref.groupId);
      if (!group) return;

      const doomed = new Set([
        ref.groupId,
        ...descendantGroupIds(store.groups(ref.scopeId), ref.groupId),
      ]);
      const affected = store
        .items(ref.scopeId)
        .filter((item) => item.groupId !== undefined && doomed.has(item.groupId)).length;

      const parentName = group.parentId
        ? (store.getGroup(ref.scopeId, group.parentId)?.name ?? 'the parent group')
        : 'the top level';
      const choice = await vscode.window.showWarningMessage(
        `Delete group "${group.name}"?`,
        {
          modal: true,
          detail:
            affected === 0
              ? 'The group is empty.'
              : `It holds ${affected} item(s). Move them to ${parentName}, or delete them too.`,
        },
        `Move to ${group.parentId ? 'parent' : 'top level'}`,
        'Delete items too',
      );
      if (!choice) return;
      await guard(() =>
        store.deleteGroup(
          ref.scopeId,
          ref.groupId,
          choice === 'Delete items too' ? 'deleteItems' : 'moveToParent',
        ),
      );
    }),
  ];
}
