import * as vscode from 'vscode';
import { SnipPickApiClient, normalizeBaseUrl } from '@snip-pick/api-client';
import { vaultKey, type VaultSummary } from '@snip-pick/contracts';
import { log } from '../log';
import {
  AUTH_PROVIDER_ID,
  SCOPES,
  SnipPickAuthProvider,
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

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly provider: SnipPickAuthProvider,
  ) {
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
      this.set({ vaults: [] });
      return;
    }
    const session = await this.provider.sessionFor(normalize(serverUrl));
    if (!session) {
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

  private set(state: RemoteState): void {
    this.state = state;
    this.emitter.fire();
  }

  /** Starts the OAuth flow; VS Code shows the account in its Accounts menu afterwards. */
  async signIn(): Promise<void> {
    const serverUrl = await resolveServerUrl();
    if (!serverUrl) return;
    await vscode.authentication.getSession(AUTH_PROVIDER_ID, SCOPES, { createIfNone: true });
    await this.refresh();
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
    this.emitter.fire();
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
