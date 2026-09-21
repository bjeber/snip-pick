import * as vscode from 'vscode';
import { SnipPickApiClient, normalizeBaseUrl } from '@snip-pick/api-client';
import { vaultKey, type VaultSummary } from '@snip-pick/contracts';
import { log } from '../log';
import type { Store } from '../store/store';
import { SyncEngine } from './syncEngine';
import {
  AUTH_PROVIDER_ID,
  SCOPES,
  SnipPickAuthProvider,
  promptForServerUrl,
  resolveServerUrl,
} from '../auth/authProvider';

const MOUNTED_KEY = 'snipPick.mountedVaults';

export interface RemoteState {
  serverUrl?: string;
  account?: string;
  vaults: VaultSummary[];
  error?: string;
}

/**
 * Keeps the signed-in session and the vault list the tree renders.
 *
 * Reads are synchronous on purpose: the tree and the Quick Pick are built synchronously, so this
 * holds a cache and refreshes in the background rather than making every consumer await a socket.
 * That is also the shape the delta sync will need.
 */
export class RemoteService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.emitter.event;

  private readonly disposables: vscode.Disposable[] = [];
  private state: RemoteState = { vaults: [] };

  readonly engine: SyncEngine;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: SnipPickAuthProvider,
    private readonly store: Store,
  ) {
    this.engine = new SyncEngine(context, store);
    this.disposables.push(
      this.emitter,
      vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id === AUTH_PROVIDER_ID) void this.refresh();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('snipPick.remote.url')) void this.refresh();
      }),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  /** Vault list as last fetched. */
  vaults(): readonly VaultSummary[] {
    return this.state.vaults;
  }

  signedIn(): boolean {
    return this.state.account !== undefined;
  }

  current(): RemoteState {
    return this.state;
  }

  private mountedKeys(): string[] {
    return this.context.globalState.get<string[]>(MOUNTED_KEY, []);
  }

  /** The vaults the user chose to show in the tree. */
  mounted(): VaultSummary[] {
    const serverUrl = this.state.serverUrl;
    if (!serverUrl) return [];
    const keys = new Set(this.mountedKeys());
    return this.state.vaults.filter((vault) => keys.has(vaultKey(serverUrl, vault.id)));
  }

  isMounted(vault: VaultSummary): boolean {
    const serverUrl = this.state.serverUrl;
    return serverUrl !== undefined && this.mountedKeys().includes(vaultKey(serverUrl, vault.id));
  }

  /** Reloads the vault list for the configured server, if there is a session for it. */
  async refresh(): Promise<void> {
    const serverUrl = SnipPickAuthProvider.configuredServerUrl();
    if (!serverUrl) {
      await this.unmountAll();
      this.set({ vaults: [] });
      return;
    }
    const session = await this.provider.sessionFor(normalize(serverUrl));
    if (!session) {
      await this.unmountAll();
      this.set({ serverUrl: normalize(serverUrl), vaults: [] });
      return;
    }
    try {
      const client = new SnipPickApiClient(
        session.resource,
        async () => session.tokens.accessToken,
      );
      const vaults = await client.vaults();
      this.set({ serverUrl: session.serverUrl, account: session.account.label, vaults });
      log().info(`Loaded ${vaults.length} remote vault(s) from ${session.serverUrl}`);
      await this.mountAndSync(client, session.serverUrl);
    } catch (error) {
      const message = (error as Error).message;
      this.set({
        serverUrl: session.serverUrl,
        account: session.account.label,
        vaults: [],
        error: message,
      });
      log().error(`Could not list vaults: ${message}`);
    }
  }

  /**
   * Makes the mounted vaults into scopes and brings them up to date.
   *
   * Mounting first, syncing second: the sync writes through the store, so the scope it writes to
   * has to exist before the first delta arrives.
   */
  private async mountAndSync(client: SnipPickApiClient, serverUrl: string): Promise<void> {
    const mounted = this.mounted();
    const scopes = this.engine.scopesFor(serverUrl, mounted);
    this.engine.retain(scopes.map((scope) => scope.id));
    await this.store.setRemoteScopes(scopes);
    await this.engine.syncAll(client, serverUrl, mounted);
    this.emitter.fire();
  }

  /** Unmounts everything, for sign-out: a vault nobody is authenticated for is not a scope. */
  private async unmountAll(): Promise<void> {
    this.engine.retain([]);
    await this.store.setRemoteScopes([]);
  }

  private set(state: RemoteState): void {
    this.state = state;
    this.emitter.fire();
  }

  /** Starts the OAuth flow; VS Code shows the account in its Accounts menu afterwards. */
  async signIn(): Promise<void> {
    const serverUrl = await resolveServerUrl();
    if (!serverUrl) return;
    try {
      await vscode.authentication.getSession(AUTH_PROVIDER_ID, SCOPES, { createIfNone: true });
    } catch (error) {
      // A wrong URL fails here, and the raw status is not a diagnosis — so the offer to correct
      // it comes with the failure rather than leaving the URL to be hunted down in settings.
      await this.offerToChangeServer(serverUrl, (error as Error).message);
      return;
    }
    await this.refresh();
  }

  private async offerToChangeServer(serverUrl: string, reason: string): Promise<void> {
    log().error(`Sign-in to ${serverUrl} failed: ${reason}`);
    const choice = await vscode.window.showErrorMessage(
      `Snip Pick: could not sign in to ${serverUrl}.`,
      { modal: true, detail: reason },
      'Change Server…',
    );
    if (choice === 'Change Server…') await this.setServer();
  }

  /**
   * Changes the configured server, or clears it.
   *
   * Separate from signing in because the two fail independently: a server that cannot be reached
   * at all still has to be editable, and before this there was nowhere to do it from — the tree
   * offered only "Sign in", which read the same broken URL every time.
   */
  async setServer(): Promise<void> {
    const previous = SnipPickAuthProvider.configuredServerUrl();
    const next = await promptForServerUrl();
    if (next === previous) return;
    this.set({ vaults: [] });
    await this.refresh();
    if (next) {
      const choice = await vscode.window.showInformationMessage(
        `Snip Pick: server set to ${next}.`,
        'Sign In',
      );
      if (choice === 'Sign In') await this.signIn();
    } else {
      void vscode.window.showInformationMessage(
        'Snip Pick: no server configured. Local libraries are unaffected.',
      );
    }
  }

  async signOut(): Promise<void> {
    const serverUrl = SnipPickAuthProvider.configuredServerUrl();
    const session = serverUrl ? await this.provider.sessionFor(normalize(serverUrl)) : undefined;
    if (!session) {
      void vscode.window.showInformationMessage('Snip Pick: you are not signed in.');
      return;
    }
    const choice = await vscode.window.showWarningMessage(
      `Sign out of ${session.serverUrl}?`,
      { modal: true, detail: `Signed in as ${session.account.label}.` },
      'Sign Out',
    );
    if (choice !== 'Sign Out') return;
    // Goes through the provider so VS Code's Accounts menu stays in step, and so RP-initiated
    // logout clears the browser session too.
    await this.provider.removeSession(session.id);
    await this.refresh();
  }

  /** Lets the user choose which vaults appear in the tree. */
  async selectVaults(): Promise<void> {
    await this.refresh();
    const serverUrl = this.state.serverUrl;
    if (!serverUrl || !this.signedIn()) {
      void vscode.window.showInformationMessage('Snip Pick: sign in to a server first.');
      return;
    }
    if (this.state.vaults.length === 0) {
      void vscode.window.showInformationMessage(
        this.state.error ?? 'Snip Pick: no vaults are available on this server yet.',
      );
      return;
    }

    const picked = await vscode.window.showQuickPick(
      this.state.vaults.map((vault) => ({
        label: `$(${vault.kind === 'personal' ? 'account' : 'organization'}) ${vault.name}`,
        description: vault.organization.name,
        detail:
          vault.kind === 'personal' ? 'Your private vault in this tenant' : 'Shared project vault',
        picked: this.isMounted(vault),
        vault,
      })),
      { title: 'Which vaults should appear in the tree?', canPickMany: true },
    );
    if (!picked) return;

    await this.context.globalState.update(
      MOUNTED_KEY,
      picked.map((entry) => vaultKey(serverUrl, entry.vault.id)),
    );
    await this.refresh();
  }
}

/** Must match how the session's URL was normalised at sign-in, or lookups silently miss. */
function normalize(url: string): string {
  try {
    return normalizeBaseUrl(url);
  } catch {
    return url.trim().replace(/\/+$/, '');
  }
}
