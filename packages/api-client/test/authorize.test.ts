import { describe, expect, it } from 'vitest';
import { AuthorizationError, buildAuthorizeUrl, parseCallback } from '../src/authorize';

const request = {
  authorizationEndpoint: 'https://snips.acme.test/api/auth/oauth2/authorize',
  clientId: 'snip-pick-vscode',
  redirectUri: 'vscode://bieber.snip-pick/auth',
  scopes: ['openid', 'profile', 'offline_access'],
  state: 'state-123',
  nonce: 'nonce-456',
  codeChallenge: 'challenge-789',
  resource: 'https://snips.acme.test/v1',
};

describe('buildAuthorizeUrl', () => {
  it('includes every parameter the server needs', () => {
    const url = new URL(buildAuthorizeUrl(request));
    expect(url.origin + url.pathname).toBe(request.authorizationEndpoint);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'snip-pick-vscode',
      redirect_uri: 'vscode://bieber.snip-pick/auth',
      scope: 'openid profile offline_access',
      state: 'state-123',
      nonce: 'nonce-456',
      code_challenge: 'challenge-789',
      code_challenge_method: 'S256',
      resource: 'https://snips.acme.test/v1',
    });
  });

  it('omits optional parameters that were not given', () => {
    const url = new URL(buildAuthorizeUrl({ ...request, resource: undefined }));
    expect(url.searchParams.has('resource')).toBe(false);
    expect(url.searchParams.has('prompt')).toBe(false);
  });

  it('keeps query already present on the endpoint', () => {
    const url = new URL(
      buildAuthorizeUrl({
        ...request,
        authorizationEndpoint: `${request.authorizationEndpoint}?tenant=acme`,
      }),
    );
    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(url.searchParams.get('client_id')).toBe('snip-pick-vscode');
  });
});

describe('parseCallback', () => {
  const callback = (query: string) => `vscode://bieber.snip-pick/auth?${query}`;

  it('returns the code when state matches', () => {
    expect(parseCallback(callback('code=abc&state=state-123'), { state: 'state-123' })).toBe('abc');
  });

  it('rejects a mismatched state', () => {
    expect(() => parseCallback(callback('code=abc&state=other'), { state: 'state-123' })).toThrow(
      AuthorizationError,
    );
    try {
      parseCallback(callback('code=abc&state=other'), { state: 'state-123' });
    } catch (error) {
      expect((error as AuthorizationError).code).toBe('state_mismatch');
    }
  });

  it('rejects a missing state even when a code is present', () => {
    expect(() => parseCallback(callback('code=abc'), { state: 'state-123' })).toThrow(
      /did not match/,
    );
  });

  it('surfaces a server-reported error with its description', () => {
    expect(() =>
      parseCallback(callback('error=access_denied&error_description=User+said+no'), {
        state: 'state-123',
      }),
    ).toThrow('User said no');
  });

  it('rejects a response from the wrong issuer (RFC 9207)', () => {
    expect(() =>
      parseCallback(callback('code=abc&state=state-123&iss=https%3A%2F%2Fevil.test'), {
        state: 'state-123',
        issuer: 'https://snips.acme.test/api/auth',
      }),
    ).toThrow(/evil\.test/);
  });

  it('accepts a matching issuer, and tolerates one not being sent', () => {
    const expected = { state: 'state-123', issuer: 'https://snips.acme.test/api/auth' };
    expect(
      parseCallback(
        callback('code=abc&state=state-123&iss=https%3A%2F%2Fsnips.acme.test%2Fapi%2Fauth'),
        expected,
      ),
    ).toBe('abc');
    expect(parseCallback(callback('code=abc&state=state-123'), expected)).toBe('abc');
  });

  it('rejects a response with no code', () => {
    expect(() => parseCallback(callback('state=state-123'), { state: 'state-123' })).toThrow(
      /no code/,
    );
  });
});
