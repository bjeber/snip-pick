import type * as vscode from 'vscode';
import type { TokenSet } from '@snip-pick/api-client';

const SECRET_KEY = 'snipPick.sessions';

export interface StoredSession {
  id: string;
  /** Origin the user signed in to; sessions from different deployments coexist. */
  serverUrl: string;
  /** RFC 8707 identifier the access token is bound to. */
  resource: string;
  issuer: string;
  tokenEndpoint: string;
  endSessionEndpoint?: string;
  account: { id: string; label: string };
  scopes: string[];
  tokens: TokenSet;
}

/**
 * Sessions live in SecretStorage, never in settings or a workspace file.
 *
 * The whole set is stored under one key: tokens are small, and a single read keeps
 * `getSessions()` — which VS Code calls often — cheap.
 */
export class SessionStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async all(): Promise<StoredSession[]> {
    const raw = await this.secrets.get(SECRET_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as StoredSession[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // Corrupt or from an incompatible version: start clean rather than wedging sign-in.
      return [];
    }
  }

  private async write(sessions: StoredSession[]): Promise<void> {
    if (sessions.length === 0) await this.secrets.delete(SECRET_KEY);
    else await this.secrets.store(SECRET_KEY, JSON.stringify(sessions));
  }

  /** Adds or replaces a session, keyed by id. */
  async upsert(session: StoredSession): Promise<void> {
    const sessions = await this.all();
    const index = sessions.findIndex((entry) => entry.id === session.id);
    if (index === -1) sessions.push(session);
    else sessions[index] = session;
    await this.write(sessions);
  }

  async remove(id: string): Promise<StoredSession | undefined> {
    const sessions = await this.all();
    const index = sessions.findIndex((entry) => entry.id === id);
    if (index === -1) return undefined;
    const [removed] = sessions.splice(index, 1);
    await this.write(sessions);
    return removed;
  }

  async clear(): Promise<void> {
    await this.write([]);
  }
}
