import { describe, expect, it, vi } from 'vitest';
import {
  EXPIRY_SKEW_MS,
  TokenError,
  exchangeCode,
  isExpired,
  readClaims,
  refreshTokens,
  type TokenSet,
} from '../src/tokens';

const ENDPOINT = 'https://snips.acme.test/api/auth/oauth2/token';
const NOW = 1_700_000_000_000;

function respondWith(body: unknown, status = 200) {
  return vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

function formOf(fetchImpl: ReturnType<typeof respondWith>): URLSearchParams {
  const init = fetchImpl.mock.calls[0]?.[1];
  return new URLSearchParams(init?.body as string);
}

describe('exchangeCode', () => {
  it('posts the grant with the PKCE verifier and returns an absolute expiry', async () => {
    const fetchImpl = respondWith({
      access_token: 'at',
      refresh_token: 'rt',
      id_token: 'it',
      expires_in: 3600,
      scope: 'openid offline_access',
    });
    const tokens = await exchangeCode(
      {
        tokenEndpoint: ENDPOINT,
        clientId: 'snip-pick-vscode',
        code: 'the-code',
        codeVerifier: 'the-verifier',
        redirectUri: 'vscode://bieber.snip-pick/auth',
        resource: 'https://snips.acme.test/v1',
      },
      fetchImpl,
      NOW,
    );

    const form = formOf(fetchImpl);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code_verifier')).toBe('the-verifier');
    expect(form.get('resource')).toBe('https://snips.acme.test/v1');
    // A public client sends no secret — that is what PKCE replaces.
    expect(form.has('client_secret')).toBe(false);

    expect(tokens).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      idToken: 'it',
      expiresAt: NOW + 3_600_000,
      scopes: ['openid', 'offline_access'],
    });
  });

  it('defaults the lifetime when the server omits expires_in', async () => {
    const tokens = await exchangeCode(
      {
        tokenEndpoint: ENDPOINT,
        clientId: 'c',
        code: 'x',
        codeVerifier: 'v',
        redirectUri: 'r',
      },
      respondWith({ access_token: 'at' }),
      NOW,
    );
    expect(tokens.expiresAt).toBe(NOW + 3_600_000);
    expect(tokens.scopes).toEqual([]);
  });

  it('turns an OAuth error response into a typed failure', async () => {
    const fetchImpl = respondWith(
      { error: 'invalid_grant', error_description: 'code already used' },
      400,
    );
    await expect(
      exchangeCode(
        { tokenEndpoint: ENDPOINT, clientId: 'c', code: 'x', codeVerifier: 'v', redirectUri: 'r' },
        fetchImpl,
        NOW,
      ),
    ).rejects.toMatchObject({ name: 'TokenError', code: 'invalid_grant' });
  });

  it('fails when a 200 carries no access token', async () => {
    await expect(
      exchangeCode(
        { tokenEndpoint: ENDPOINT, clientId: 'c', code: 'x', codeVerifier: 'v', redirectUri: 'r' },
        respondWith({ token_type: 'Bearer' }),
        NOW,
      ),
    ).rejects.toThrow(TokenError);
  });
});

describe('refreshTokens', () => {
  const existing: TokenSet = {
    accessToken: 'old',
    refreshToken: 'rt',
    expiresAt: NOW,
    scopes: ['openid'],
  };

  it('sends the refresh grant', async () => {
    const fetchImpl = respondWith({ access_token: 'new', expires_in: 600 });
    const tokens = await refreshTokens(
      { tokenEndpoint: ENDPOINT, clientId: 'c', tokens: existing },
      fetchImpl,
      NOW,
    );
    expect(formOf(fetchImpl).get('refresh_token')).toBe('rt');
    expect(tokens.accessToken).toBe('new');
    expect(tokens.expiresAt).toBe(NOW + 600_000);
  });

  it('keeps the old refresh token when the server does not rotate it', async () => {
    const tokens = await refreshTokens(
      { tokenEndpoint: ENDPOINT, clientId: 'c', tokens: existing },
      respondWith({ access_token: 'new' }),
      NOW,
    );
    expect(tokens.refreshToken).toBe('rt');
    expect(tokens.scopes).toEqual(['openid']);
  });

  it('adopts a rotated refresh token', async () => {
    const tokens = await refreshTokens(
      { tokenEndpoint: ENDPOINT, clientId: 'c', tokens: existing },
      respondWith({ access_token: 'new', refresh_token: 'rotated' }),
      NOW,
    );
    expect(tokens.refreshToken).toBe('rotated');
  });

  it('refuses without a refresh token instead of calling the server', async () => {
    const fetchImpl = respondWith({});
    await expect(
      refreshTokens(
        {
          tokenEndpoint: ENDPOINT,
          clientId: 'c',
          tokens: { ...existing, refreshToken: undefined },
        },
        fetchImpl,
        NOW,
      ),
    ).rejects.toMatchObject({ code: 'no_refresh_token' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('isExpired', () => {
  const tokens: TokenSet = { accessToken: 'a', expiresAt: NOW + 10 * 60_000, scopes: [] };

  it('is false well before expiry and true after', () => {
    expect(isExpired(tokens, NOW)).toBe(false);
    expect(isExpired(tokens, NOW + 11 * 60_000)).toBe(true);
  });

  it('treats the skew window as expired, so a request never races its own check', () => {
    expect(isExpired(tokens, tokens.expiresAt - EXPIRY_SKEW_MS + 1)).toBe(true);
    expect(isExpired(tokens, tokens.expiresAt - EXPIRY_SKEW_MS - 1)).toBe(false);
  });
});

describe('readClaims', () => {
  it('reads a JWT payload', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'user-1' })).toString('base64url');
    expect(readClaims(`header.${payload}.signature`)).toEqual({ sub: 'user-1' });
  });

  it('returns undefined for anything unparseable', () => {
    expect(readClaims('not-a-jwt')).toBeUndefined();
    expect(readClaims('a.!!!.c')).toBeUndefined();
  });
});
