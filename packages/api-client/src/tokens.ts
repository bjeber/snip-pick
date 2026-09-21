import type { FetchLike } from './discovery';

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  scopes: string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

export class TokenError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TokenError';
  }
}

/** Refresh a little early, so a request never races the expiry it just checked. */
export const EXPIRY_SKEW_MS = 60_000;

export function isExpired(tokens: TokenSet, now = Date.now(), skewMs = EXPIRY_SKEW_MS): boolean {
  return tokens.expiresAt - skewMs <= now;
}

function toTokenSet(body: TokenResponse, now: number, previous?: TokenSet): TokenSet {
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  return {
    accessToken: body.access_token,
    // Servers that rotate refresh tokens send a new one; those that do not expect reuse.
    ...((body.refresh_token ?? previous?.refreshToken)
      ? { refreshToken: body.refresh_token ?? previous?.refreshToken }
      : {}),
    ...(body.id_token ? { idToken: body.id_token } : {}),
    expiresAt: now + expiresIn * 1000,
    scopes: body.scope ? body.scope.split(' ').filter(Boolean) : (previous?.scopes ?? []),
  };
}

async function post(
  fetchImpl: FetchLike,
  endpoint: string,
  form: Record<string, string>,
  now: number,
  previous?: TokenSet,
): Promise<TokenSet> {
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  const body = (await response.json().catch(() => ({}))) as TokenResponse &
    Partial<{ error: string; error_description: string }>;
  if (!response.ok || !body.access_token) {
    throw new TokenError(
      body.error_description ?? body.error ?? `The token endpoint answered ${response.status}.`,
      body.error ?? 'token_request_failed',
    );
  }
  return toTokenSet(body, now, previous);
}

export interface ExchangeRequest {
  tokenEndpoint: string;
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
  resource?: string;
}

export async function exchangeCode(
  request: ExchangeRequest,
  fetchImpl: FetchLike = globalThis.fetch,
  now = Date.now(),
): Promise<TokenSet> {
  return post(
    fetchImpl,
    request.tokenEndpoint,
    {
      grant_type: 'authorization_code',
      code: request.code,
      redirect_uri: request.redirectUri,
      client_id: request.clientId,
      code_verifier: request.codeVerifier,
      ...(request.resource ? { resource: request.resource } : {}),
    },
    now,
  );
}

export interface RefreshRequest {
  tokenEndpoint: string;
  clientId: string;
  tokens: TokenSet;
  resource?: string;
}

export async function refreshTokens(
  request: RefreshRequest,
  fetchImpl: FetchLike = globalThis.fetch,
  now = Date.now(),
): Promise<TokenSet> {
  const refreshToken = request.tokens.refreshToken;
  if (!refreshToken) {
    throw new TokenError('This session has no refresh token; sign in again.', 'no_refresh_token');
  }
  return post(
    fetchImpl,
    request.tokenEndpoint,
    {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: request.clientId,
      ...(request.resource ? { resource: request.resource } : {}),
    },
    now,
    request.tokens,
  );
}

/** Reads the unverified payload of a JWT. Only for display — never for a trust decision. */
export function readClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1];
  if (!payload) return undefined;
  try {
    const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}
