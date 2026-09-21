import type * as vscode from 'vscode';

const HISTORY_KEY = 'snipPick.variableHistory';

type History = Record<string, Record<string, string>>;

/** Remembers the last value entered for each `{{variable}}`, per item, in the workspace state. */
export class VariableHistory {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private all(): History {
    return this.context.workspaceState.get<History>(HISTORY_KEY, {});
  }

  get(itemId: string, name: string): string | undefined {
    return this.all()[itemId]?.[name];
  }

  async remember(itemId: string, values: Record<string, string>): Promise<void> {
    const all = this.all();
    await this.context.workspaceState.update(HISTORY_KEY, {
      ...all,
      [itemId]: { ...all[itemId], ...values },
    });
  }

  async forget(itemId: string): Promise<void> {
    const all = { ...this.all() };
    delete all[itemId];
    await this.context.workspaceState.update(HISTORY_KEY, all);
  }
}
