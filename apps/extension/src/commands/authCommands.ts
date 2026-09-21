import * as vscode from 'vscode';
import { guard } from './itemCommands';
import type { Services } from './services';

export function registerAuthCommands(services: Services): vscode.Disposable[] {
  const { remote } = services;

  return [
    vscode.commands.registerCommand('snipPick.signIn', async () => {
      await guard(() => remote.signIn());
    }),

    vscode.commands.registerCommand('snipPick.signOut', async () => {
      await guard(() => remote.signOut());
    }),

    vscode.commands.registerCommand('snipPick.selectVaults', async () => {
      await guard(() => remote.selectVaults());
    }),

    vscode.commands.registerCommand('snipPick.refreshRemote', async () => {
      await guard(() => remote.refresh());
    }),
  ];
}
