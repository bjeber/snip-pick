import * as vscode from 'vscode';
import type { Services } from './services';

export function registerSecretCommands(services: Services): vscode.Disposable[] {
  const { secrets } = services;

  return [
    vscode.commands.registerCommand('snipPick.setSecret', async () => {
      const name = await vscode.window.showInputBox({
        title: 'Snip Pick secret',
        prompt: 'Name, as used in {{secret:NAME}}',
        validateInput: (value) => (value.trim().length === 0 ? 'A name is required' : undefined),
      });
      if (!name) return;
      const value = await vscode.window.showInputBox({
        title: `Snip Pick secret: ${name.trim()}`,
        prompt: 'Value (stored in VS Code secret storage, never in a file)',
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return;
      await secrets.set(name.trim(), value);
      void vscode.window.showInformationMessage(`Snip Pick: stored secret "${name.trim()}".`);
    }),

    vscode.commands.registerCommand('snipPick.clearSecrets', async () => {
      const names = secrets.names();
      if (names.length === 0) {
        void vscode.window.showInformationMessage('Snip Pick: no secrets are stored.');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        [
          { label: 'All secrets', description: `${names.length} stored` },
          ...names.map((name) => ({ label: name })),
        ],
        { title: 'Clear which secret?' },
      );
      if (!picked) return;
      if (picked.label === 'All secrets') {
        const confirmed = await vscode.window.showWarningMessage(
          `Delete all ${names.length} stored secrets?`,
          { modal: true },
          'Delete',
        );
        if (confirmed !== 'Delete') return;
        await secrets.clear();
      } else {
        await secrets.delete(picked.label);
      }
      void vscode.window.showInformationMessage('Snip Pick: secrets cleared.');
    }),
  ];
}
