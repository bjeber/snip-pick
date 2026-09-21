import type * as vscode from 'vscode';

const NAMES_KEY = 'snipPick.secretNames';
const PREFIX = 'snipPick.secret.';

/**
 * Thin wrapper over SecretStorage. Values never touch a `snippick.json` file; only the set of
 * known names is remembered, because SecretStorage cannot be enumerated.
 */
export class SecretsStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  names(): string[] {
    return [...this.context.globalState.get<string[]>(NAMES_KEY, [])].sort((a, b) =>
      a.localeCompare(b),
    );
  }

  async get(name: string): Promise<string | undefined> {
    return this.context.secrets.get(PREFIX + name);
  }

  async set(name: string, value: string): Promise<void> {
    await this.context.secrets.store(PREFIX + name, value);
    const names = new Set(this.context.globalState.get<string[]>(NAMES_KEY, []));
    names.add(name);
    await this.context.globalState.update(NAMES_KEY, [...names]);
  }

  async delete(name: string): Promise<void> {
    await this.context.secrets.delete(PREFIX + name);
    const names = this.context.globalState
      .get<string[]>(NAMES_KEY, [])
      .filter((entry) => entry !== name);
    await this.context.globalState.update(NAMES_KEY, names);
  }

  async clear(): Promise<void> {
    for (const name of this.names()) await this.delete(name);
  }
}
