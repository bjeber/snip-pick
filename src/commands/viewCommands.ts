import * as vscode from 'vscode';
import { openQuickPick } from '../ui/quickPick';
import { createCommandItem } from './createCommands';
import { guard } from './itemCommands';
import type { Services } from './services';

export const RELEVANT_ONLY_CONTEXT = 'snipPick.relevantOnly';

/** Keeps the `when` context key for the title toggle in sync with the setting. */
export function syncRelevantOnlyContext(): void {
  const enabled = vscode.workspace
    .getConfiguration('snipPick')
    .get<boolean>('showRelevantOnly', false);
  void vscode.commands.executeCommand('setContext', RELEVANT_ONLY_CONTEXT, enabled);
}

export function registerViewCommands(services: Services): vscode.Disposable[] {
  const { store, usage, contextService, runner, discovery, tree } = services;

  return [
    vscode.commands.registerCommand('snipPick.open', () => {
      openQuickPick({
        store,
        usage,
        contextService,
        actions: {
          activate: (scopeId, itemId) => runner.activate({ scopeId, itemId }),
          copy: (scopeId, itemId) => runner.copy({ scopeId, itemId }),
          edit: async (scopeId, itemId) => {
            await vscode.commands.executeCommand('snipPick.edit', {
              kind: 'item',
              scopeId,
              itemId,
            });
          },
          togglePin: async (scopeId, itemId) => {
            await vscode.commands.executeCommand('snipPick.togglePin', {
              kind: 'item',
              scopeId,
              itemId,
            });
          },
          createCommand: (body) => createCommandItem(services, undefined, body),
        },
      });
    }),

    vscode.commands.registerCommand('snipPick.toggleRelevantOnly', async () => {
      const configuration = vscode.workspace.getConfiguration('snipPick');
      const next = !configuration.get<boolean>('showRelevantOnly', false);
      const target = vscode.workspace.workspaceFolders
        ? vscode.ConfigurationTarget.Workspace
        : vscode.ConfigurationTarget.Global;
      await configuration.update('showRelevantOnly', next, target);
      syncRelevantOnlyContext();
      tree.refresh();
    }),

    vscode.commands.registerCommand('snipPick.refresh', async () => {
      await guard(async () => {
        await store.reloadAll();
        await discovery.refresh();
        tree.refresh();
      });
    }),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('snipPick.showRelevantOnly')) syncRelevantOnlyContext();
    }),
  ];
}
