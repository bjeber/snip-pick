import type {
  MeResponse,
  VaultDelta,
  VaultListResponse,
  VaultPush,
  VaultPushResult,
  VaultSummary,
} from '@snip-pick/contracts';
import type { FetchLike } from './discovery';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** `true` when the access token was rejected, so the caller should refresh and retry once. */
  get isUnauthorized(): boolean {
    return this.status === 401;
  }
}

/** Typed access to the vault API. Token retrieval is injected so refresh stays the caller's job. */
export class SnipPickApiClient {
  constructor(
    private readonly resourceBaseUrl: string,
    private readonly accessToken: () => Promise<string>,
    private readonly fetchImpl: FetchLike = globalThis.fetch,
  ) {}

  private async get<T>(path: string): Promise<T> {
    const response = await this.fetchImpl(`${this.resourceBaseUrl}${path}`, {
      headers: { authorization: `Bearer ${await this.accessToken()}`, accept: 'application/json' },
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error_description?: string };
      throw new ApiError(
        body.error_description ?? `${path} answered ${response.status}.`,
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  async me(): Promise<MeResponse> {
    return this.get<MeResponse>('/me');
  }

  async vaults(): Promise<VaultSummary[]> {
    return (await this.get<VaultListResponse>('/vaults')).vaults;
  }

  /** Everything that changed after `since`. `since = 0`, the default, is the whole vault. */
  async pull(vaultId: string, since = 0): Promise<VaultDelta> {
    return this.get<VaultDelta>(`/vaults/${encodeURIComponent(vaultId)}/delta?since=${since}`);
  }

  /**
   * Offers local changes.
   *
   * A 409 is not an error to throw on: it is the server reporting that both sides changed the
   * same entities, and it carries them. The caller shows them to the person and pushes again
   * once they have decided, so it comes back as an ordinary result.
   */
  async push(vaultId: string, push: VaultPush): Promise<VaultPushResult> {
    const response = await this.fetchImpl(
      `${this.resourceBaseUrl}/vaults/${encodeURIComponent(vaultId)}/delta`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.accessToken()}`,
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: JSON.stringify(push),
      },
    );
    if (response.ok || response.status === 409) {
      return (await response.json()) as VaultPushResult;
    }
    const body = (await response.json().catch(() => ({}))) as { error_description?: string };
    throw new ApiError(
      body.error_description ?? `Pushing to ${vaultId} answered ${response.status}.`,
      response.status,
    );
  }
}
