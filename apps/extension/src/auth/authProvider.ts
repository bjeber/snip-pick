import * as vscode from 'vscode';
import {
  SnipPickApiClient,
  buildAuthorizeUrl,
  createPkcePair,
  describeServer,
  exchangeCode,
  isExpired,
  parseCallback,
  randomString,
  refreshTokens,
  type TokenSet,
} from '@snip-pick/api-client';
import { log } from '../log';
import { AuthCallbackRouter } from './callbackRouter';
import { SessionStore, type StoredSession } from './sessionStore';

export const AUTH_PROVIDER_ID = 'snip-pick';
const AUTH_PROVIDER_LABEL = 'Snip Pick';
const CLIENT_ID = 'snip-pick-vscode';

/** `offline_access` is what earns a refresh token; `openid` is what makes it an OIDC request. */
export const SCOPES = ['openid', 'profile', 'email', 'offline_access'];

function toSession(stored: StoredSession): vscode.AuthenticationSession {
  return {
    id: stored.id,
    accessToken: stored.tokens.accessToken,
    account: stored.account,
    scopes: stored.scopes,
  };
}

/**
 * Signs in to a self-hosted Snip Pick API with OAuth 2.1 + PKCE.
 *
 * Registered as a real `AuthenticationProvider` rather than a bespoke command so sessions show up
 * in VS Code's Accounts menu, sign-out works from there, and several accounts — someone who
 * consults for two companies — can coexist.
 */
export class SnipPickAuthProvider implements vscode.AuthenticationProvider, vscode.Disposable {
  private readonly emitter =
    new vscode.EventEmitter<vscode.AuthenticationProviderAuthenticationSessionsChangeEvent>();
  readonly onDidChangeSessions = this.emitter.event;

  private readonly store: SessionStore;
  private readonly router: AuthCallbackRouter;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly context: vscode.ExtensionContext) {
    this.store = new SessionStore(context.secrets);
    this.router = new AuthCallbackRouter();
    this.disposables.push(
      this.emitter,
      this.router,
      vscode.authentication.registerAuthenticationProvider(
        AUTH_PROVIDER_ID,
        AUTH_PROVIDER_LABEL,
        this,
        {
          supportsMultipleAccounts: true,
        },
      ),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  /** The server this window talks to, from `snipPick.remote.url`. */
  static configuredServerUrl(): string | undefined {
    const value = vscode.workspace
      .getConfiguration('snipPick')
      .get<string>('remote.url', '')
      .trim();
    return value.length > 0 ? value : undefined;
  }

  async getSessions(scopes?: readonly string[]): Promise<vscode.AuthenticationSession[]> {
    const stored = await this.store.all();
    const wanted = scopes ? [...scopes] : undefined;
    const usable: vscode.AuthenticationSession[] = [];

    for (const session of stored) {
      if (wanted && !wanted.every((scope) => session.scopes.includes(scope))) continue;
      const fresh = await this.ensureFresh(session);
      if (fresh) usable.push(toSession(fresh));
    }
    return usable;
  }

  /** Refreshes a session whose access token is expiring; drops it if the refresh is refused. */
  private async ensureFresh(session: StoredSession): Promise<StoredSession | undefined> {
    if (!isExpired(session.tokens)) return session;
    try {
      const tokens: TokenSet = await refreshTokens({
        tokenEndpoint: session.tokenEndpoint,
        clientId: CLIENT_ID,
        tokens: session.tokens,
        resource: session.resource,
      });
      const updated: StoredSession = { ...session, tokens };
      await this.store.upsert(updated);
      log().debug(`Refreshed the access token for ${session.account.label}`);
      return updated;
    } catch (error) {
      log().warn(`Could not refresh ${session.account.label}: ${(error as Error).message}`);
      await this.store.remove(session.id);
      this.emitter.fire({ added: [], removed: [toSession(session)], changed: [] });
      return undefined;
    }
  }

  async createSession(scopes: readonly string[]): Promise<vscode.AuthenticationSession> {
    const serverUrl = await resolveServerUrl();
    if (!serverUrl) throw new Error('No Snip Pick server URL was given.');

    const stored = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Signing in to Snip Pick…',
        cancellable: true,
      },
      (_progress, cancellation) => this.runFlow(serverUrl, [...scopes], cancellation),
    );

    await this.store.upsert(stored);
    const session = toSession(stored);
    this.emitter.fire({ added: [session], removed: [], changed: [] });
    log().info(`Signed in to ${stored.serverUrl} as ${stored.account.label}`);
    return session;
  }

  private async runFlow(
    serverUrl: string,
    scopes: string[],
    cancellation: vscode.CancellationToken,
  ): Promise<StoredSession> {
    const server = await describeServer(serverUrl);

    // asExternalUri makes the callback work under Remote SSH, Codespaces and vscode.dev, where
    // the editor is not the thing the browser can reach directly.
    const callback = await vscode.env.asExternalUri(
      vscode.Uri.parse(`${vscode.env.uriScheme}://bieber.snip-pick/auth`),
    );
    const redirectUri = callback.toString(true);

    const pkce = await createPkcePair();
    const state = randomString(16);
    const authorizeUrl = buildAuthorizeUrl({
      authorizationEndpoint: server.metadata.authorization_endpoint,
      clientId: CLIENT_ID,
      redirectUri,
      scopes,
      state,
      nonce: randomString(16),
      codeChallenge: pkce.challenge,
      resource: server.resource,
    });

    const waiting = this.router.wait(state, cancellation);
    const opened = await vscode.env.openExternal(vscode.Uri.parse(authorizeUrl));
    if (!opened) throw new Error('Could not open a browser to complete sign-in.');

    const callbackUri = await waiting;
    const code = parseCallback(callbackUri.toString(true), {
      state,
      issuer: server.metadata.issuer,
    });

    const tokens = await exchangeCode({
      tokenEndpoint: server.metadata.token_endpoint,
      clientId: CLIENT_ID,
      code,
      codeVerifier: pkce.verifier,
      redirectUri,
      resource: server.resource,
    });

    const client = new SnipPickApiClient(server.resource, async () => tokens.accessToken);
    const me = await client.me();
    const host = new URL(server.baseUrl).host;

    return {
      id: `${server.baseUrl}#${me.userId}`,
      serverUrl: server.baseUrl,
      resource: server.resource,
      issuer: server.metadata.issuer,
      tokenEndpoint: server.metadata.token_endpoint,
      ...(server.metadata.end_session_endpoint
        ? { endSessionEndpoint: server.metadata.end_session_endpoint }
        : {}),
      account: { id: me.userId, label: `${me.userId} (${host})` },
      scopes: tokens.scopes.length > 0 ? tokens.scopes : scopes,
      tokens,
    };
  }

  async removeSession(sessionId: string): Promise<void> {
    const removed = await this.store.remove(sessionId);
    if (!removed) return;
    this.emitter.fire({ added: [], removed: [toSession(removed)], changed: [] });

    // RP-initiated logout, so the browser session goes too rather than silently signing the user
    // straight back in on the next attempt.
    if (removed.endSessionEndpoint && removed.tokens.idToken) {
      const url = new URL(removed.endSessionEndpoint);
      url.searchParams.set('id_token_hint', removed.tokens.idToken);
      void vscode.env.openExternal(vscode.Uri.parse(url.toString()));
    }
    log().info(`Signed out of ${removed.serverUrl}`);
  }

  /** Exposed for the commands: the token a caller should send, refreshed if needed. */
  async sessionFor(serverUrl: string): Promise<StoredSession | undefined> {
    const stored = await this.store.all();
    const match = stored.find((session) => session.serverUrl === serverUrl);
    return match ? this.ensureFresh(match) : undefined;
  }

  get extensionContext(): vscode.ExtensionContext {
    return this.context;
  }
}

/** Reads the configured server URL, asking for one the first time. */
export async function resolveServerUrl(): Promise<string | undefined> {
  const configured = SnipPickAuthProvider.configuredServerUrl();
  if (configured) return configured;

  const entered = await vscode.window.showInputBox({
    title: 'Snip Pick server',
    prompt: 'URL of your Snip Pick API',
    placeHolder: 'https://snippets.your-company.internal',
    ignoreFocusOut: true,
    validateInput: (value) => (value.trim().length === 0 ? 'A URL is required' : undefined),
  });
  if (!entered) return undefined;

  const target = vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  await vscode.workspace.getConfiguration('snipPick').update('remote.url', entered.trim(), target);
  return entered.trim();
}
