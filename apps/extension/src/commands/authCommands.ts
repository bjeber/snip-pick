import * as vscode from 'vscode';
import { guard } from './itemCommands';
import type { Services } from './services';
import { ConflictDocuments, describeSide } from '../remote/conflictDocuments';

export function registerAuthCommands(services: Services): vscode.Disposable[] {
  const { remote } = services;
  const diffs = new ConflictDocuments();

  return [
    diffs,

    vscode.commands.registerCommand('snipPick.signIn', async () => {
      await guard(() => remote.signIn());
    }),

    vscode.commands.registerCommand('snipPick.signOut', async () => {
      await guard(() => remote.signOut());
    }),

    vscode.commands.registerCommand('snipPick.setServerUrl', async () => {
      await guard(() => remote.setServer());
    }),

    vscode.commands.registerCommand('snipPick.selectVaults', async () => {
      await guard(() => remote.selectVaults());
    }),

    vscode.commands.registerCommand('snipPick.refreshRemote', async () => {
      await guard(() => remote.refresh());
    }),

    vscode.commands.registerCommand('snipPick.resolveConflicts', async (arg: unknown) => {
      await guard(() =>
        resolveConflicts(services, diffs, typeof arg === 'string' ? arg : undefined),
      );
    }),
  ];
}

/**
 * Walks the person through the decisions a vault is waiting on.
 *
 * One at a time, and nothing is written until each is answered: the whole point of stopping the
 * sync was that neither version is safe to discard on the extension's own judgement.
 */
async function resolveConflicts(
  services: Services,
  diffs: ConflictDocuments,
  scopeId?: string,
): Promise<void> {
  const { remote, store } = services;
  const blocked = remote.engine.blocked();
  if (blocked.length === 0) {
    void vscode.window.showInformationMessage('Snip Pick: nothing to resolve.');
    return;
  }

  let target = scopeId ? blocked.find((state) => state.scopeId === scopeId) : undefined;
  if (!target) {
    if (blocked.length === 1) target = blocked[0];
    else {
      const picked = await vscode.window.showQuickPick(
        blocked.map((state) => ({
          label: store.scope(state.scopeId)?.label ?? state.vault.name,
          description: `${state.conflicts.length} conflict(s)`,
          state,
        })),
        { title: 'Which vault?' },
      );
      target = picked?.state;
    }
  }
  if (!target) return;

  for (const conflict of [...target.conflicts]) {
    const name = conflict.kind === 'item' ? 'Item' : 'Group';
    const title = `${name} changed in both places — ${target.conflicts.length} left`;
    let decided = false;
    while (!decided) {
      const choice = await vscode.window.showQuickPick(
        [
          {
            label: '$(person) Keep mine',
            detail: describeSide(conflict.mine),
            keep: 'mine' as const,
          },
          {
            label: '$(cloud) Keep theirs',
            detail: describeSide(conflict.theirs),
            keep: 'theirs' as const,
          },
          {
            label: '$(diff) Compare…',
            detail: 'Open the two versions side by side, then choose',
            keep: 'compare' as const,
          },
        ],
        {
          title,
          placeHolder: 'Nothing is sent or overwritten until you choose.',
          ignoreFocusOut: true,
        },
      );
      // Abandoned half way: what is left stays blocked rather than being decided by default.
      if (!choice) return;
      if (choice.keep === 'compare') {
        // Looking is not deciding, so the same question comes back once the diff is open.
        await diffs.compare(conflict, describeSide(conflict.mine ?? conflict.theirs));
        continue;
      }
      await remote.engine.resolve(target.scopeId, conflict, choice.keep);
      decided = true;
    }
  }

  // Whatever was settled can now travel.
  await remote.refresh();
}
