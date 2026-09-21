import type { MeResponse, VaultListResponse, VaultSummary } from '@snip-pick/contracts';
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
}
