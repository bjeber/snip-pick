import type * as vscode from 'vscode';
import type { Usage, UsageEntry } from '../model/types';
import { GLOBAL_SCOPE_ID } from './store';
import { pruneUsage, recordUse } from './usage';

export const USAGE_KEY = 'snipPick.usage';

/**
 * Usage statistics live outside the JSON files so that `snippick.json` stays diff-friendly.
 * Global items count in `globalState` (and therefore ride along with Settings Sync), workspace
 * items in `workspaceState`.
 */
export class UsageStore {
  constructor(private readonly context: vscode.ExtensionContext) {
    this.context.globalState.setKeysForSync([USAGE_KEY]);
  }

  private memento(scopeId: string): vscode.Memento {
    return scopeId === GLOBAL_SCOPE_ID ? this.context.globalState : this.context.workspaceState;
  }

  forScope(scopeId: string): Usage {
    return this.memento(scopeId).get<Usage>(USAGE_KEY, {});
  }

  /** Item ids are unique across scopes, so a flat map is enough for ranking. */
  all(): Usage {
    return {
      ...this.context.globalState.get<Usage>(USAGE_KEY, {}),
      ...this.context.workspaceState.get<Usage>(USAGE_KEY, {}),
    };
  }

  get(scopeId: string, itemId: string): UsageEntry | undefined {
    return this.forScope(scopeId)[itemId];
  }

  async record(scopeId: string, itemId: string): Promise<void> {
    const memento = this.memento(scopeId);
    await memento.update(USAGE_KEY, recordUse(this.forScope(scopeId), itemId, Date.now()));
  }

  async prune(scopeId: string, knownIds: Iterable<string>): Promise<void> {
    const memento = this.memento(scopeId);
    await memento.update(USAGE_KEY, pruneUsage(this.forScope(scopeId), knownIds));
  }
}
