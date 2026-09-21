import * as vscode from 'vscode';
import { isEmptyPush, reconcile, type SyncSnapshot } from '@snip-pick/core';
import {
  emptyFile,
  parseFile,
  serializeFile,
  vaultKey,
  vaultLabel,
  type SnipPickFile,
  type VaultConflict,
  type VaultSummary,
} from '@snip-pick/contracts';
import type { SnipPickApiClient } from '@snip-pick/api-client';
import { log } from '../log';
import type { ScopeInfo, Store } from '../store/store';

/** Scope ids for mounted vaults are their vault key, so they are stable across sessions. */
export function remoteScopeId(serverUrl: string, vaultId: string): string {
  return vaultKey(serverUrl, vaultId);
}

/** One file name per vault, derived from the key so two servers cannot collide. */
function fileName(scopeId: string, suffix: string): string {
  return `${Buffer.from(scopeId).toString('base64url')}${suffix}`;
}

export interface VaultSyncState {
  scopeId: string;
  vault: VaultSummary;
  conflicts: VaultConflict[];
  error?: string;
  lastSyncedAt?: number;
}

/**
 * Keeps mounted vaults in step with their server.
 *
 * The working copy is an ordinary scope file in global storage, so the editor edits a vault the
 * way it edits anything else. Beside it sits the base snapshot: the vault exactly as the server
 * had it at a known revision. Those two plus the server's delta are the three inputs the merge
 * in `@snip-pick/core` needs, and keeping the base on disk is what lets a sync resume correctly
 * after the window closes mid-flight.
 */
export class SyncEngine {
  private readonly states = new Map<string, VaultSyncState>();
  private inFlight: Promise<void> | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: Store,
  ) {}

  state(scopeId: string): VaultSyncState | undefined {
    return this.states.get(scopeId);
  }

  allStates(): VaultSyncState[] {
    return [...this.states.values()];
  }

  conflictsFor(scopeId: string): VaultConflict[] {
    return this.states.get(scopeId)?.conflicts ?? [];
  }

  /** Every mounted vault with an unresolved decision in it. */
  blocked(): VaultSyncState[] {
    return this.allStates().filter((state) => state.conflicts.length > 0);
  }

  /** The scopes the store should expose for `vaults`, in the order they were given. */
  scopesFor(serverUrl: string, vaults: readonly VaultSummary[]): ScopeInfo[] {
    return vaults.map((vault) => {
      const scopeId = remoteScopeId(serverUrl, vault.id);
      return {
        id: scopeId,
        kind: 'remote' as const,
        label: vaultLabel(vault),
        readonly: false,
        fileUri: this.workingUri(scopeId),
      };
    });
  }

  /** Drops the cached state of vaults that are no longer mounted. */
  retain(scopeIds: readonly string[]): void {
    const keep = new Set(scopeIds);
    for (const id of [...this.states.keys()]) if (!keep.has(id)) this.states.delete(id);
  }

  private workingUri(scopeId: string): vscode.Uri {
    return vscode.Uri.joinPath(this.context.globalStorageUri, 'vaults', fileName(scopeId, '.json'));
  }

  private baseUri(scopeId: string): vscode.Uri {
    return vscode.Uri.joinPath(
      this.context.globalStorageUri,
      'vaults',
      fileName(scopeId, '.base.json'),
    );
  }

  private async readBase(scopeId: string): Promise<SyncSnapshot> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.baseUri(scopeId));
      const raw = JSON.parse(new TextDecoder().decode(bytes)) as {
        revision?: unknown;
        file?: unknown;
      };
      const revision = typeof raw.revision === 'number' ? raw.revision : 0;
      const parsed = parseFile(JSON.stringify(raw.file ?? emptyFile()));
      // A corrupt base is recoverable: revision 0 re-pulls the vault and merges against an empty
      // snapshot, which adds rather than deletes. Losing the base must never look like a delete.
      return parsed.ok ? { revision, file: parsed.file } : { revision: 0, file: emptyFile() };
    } catch {
      return { revision: 0, file: emptyFile() };
    }
  }

  private async writeBase(scopeId: string, snapshot: SyncSnapshot): Promise<void> {
    const body = JSON.stringify({
      revision: snapshot.revision,
      file: JSON.parse(serializeFile(snapshot.file)) as SnipPickFile,
    });
    const uri = this.baseUri(scopeId);
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(body));
  }

  /** Syncs every mounted vault. Serialised: two passes over one vault would race on its base. */
  async syncAll(
    client: SnipPickApiClient,
    serverUrl: string,
    vaults: readonly VaultSummary[],
  ): Promise<void> {
    const run = async (): Promise<void> => {
      for (const vault of vaults) await this.syncOne(client, serverUrl, vault);
    };
    this.inFlight = this.inFlight ? this.inFlight.then(run, run) : run();
    return this.inFlight;
  }

  private async syncOne(
    client: SnipPickApiClient,
    serverUrl: string,
    vault: VaultSummary,
  ): Promise<void> {
    const scopeId = remoteScopeId(serverUrl, vault.id);
    const previous = this.states.get(scopeId);
    const state: VaultSyncState = { scopeId, vault, conflicts: previous?.conflicts ?? [] };
    this.states.set(scopeId, state);

    // A vault with a decision outstanding does not move until it is made: pushing half of it
    // would advance the revision the conflict is measured against.
    if (state.conflicts.length > 0) return;

    try {
      const base = await this.readBase(scopeId);
      const delta = await client.pull(vault.id, base.revision);
      const local = this.store.file(scopeId);
      const result = reconcile(base, local, delta);

      await this.writeBase(scopeId, result.nextBase);
      await this.store.replaceFile(scopeId, result.merged);

      if (result.conflicts.length > 0) {
        state.conflicts = result.conflicts;
        log().info(`${vaultLabel(vault)}: ${result.conflicts.length} conflict(s) to resolve`);
        return;
      }
      if (isEmptyPush(result.push)) {
        state.lastSyncedAt = Date.now();
        return;
      }

      const pushed = await client.push(vault.id, result.push);
      if (pushed.conflicts.length > 0) {
        // Someone wrote between our pull and our push. Re-pull so the base carries their version,
        // then report — the same decision, reached a moment later.
        state.conflicts = pushed.conflicts;
        const fresh = await client.pull(vault.id, result.nextBase.revision);
        await this.writeBase(scopeId, {
          revision: fresh.revision,
          file: reconcile(result.nextBase, result.nextBase.file, fresh).merged,
        });
        return;
      }
      await this.writeBase(scopeId, { revision: pushed.revision, file: result.merged });
      state.lastSyncedAt = Date.now();
      log().info(`${vaultLabel(vault)}: synced to revision ${pushed.revision}`);
    } catch (error) {
      state.error = (error as Error).message;
      log().error(`${vaultLabel(vault)}: sync failed — ${state.error}`);
    }
  }

  /**
   * Records a decision.
   *
   * The base already holds the server's version, so "theirs" is written into the working copy and
   * there is nothing left to send, while "mine" is left alone and becomes an ordinary local
   * change on the next pass. Neither can raise the same conflict again.
   */
  async resolve(scopeId: string, conflict: VaultConflict, keep: 'mine' | 'theirs'): Promise<void> {
    const state = this.states.get(scopeId);
    if (!state) return;
    if (keep === 'theirs') {
      const file = this.store.file(scopeId);
      const next: SnipPickFile = {
        ...file,
        items: [...file.items],
        groups: [...file.groups],
      };
      if (conflict.kind === 'item') {
        next.items = next.items.filter((entry) => entry.id !== conflict.id);
        if (conflict.theirs) next.items.push(conflict.theirs);
      } else {
        next.groups = next.groups.filter((entry) => entry.id !== conflict.id);
        if (conflict.theirs) next.groups.push(conflict.theirs);
      }
      await this.store.replaceFile(scopeId, next);
    }
    state.conflicts = state.conflicts.filter(
      (entry) => !(entry.kind === conflict.kind && entry.id === conflict.id),
    );
  }
}
