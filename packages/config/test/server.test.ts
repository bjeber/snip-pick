import { describe, expect, it } from 'vitest';
import { AUTH_BASE_PATH, loadServerConfig } from '../src/server';

const MINIMAL = {
  DATABASE_URL: 'postgres://user:pw@localhost:5432/db',
  BETTER_AUTH_SECRET: 'secret',
};

describe('loadServerConfig', () => {
  it('names the variable that is missing', () => {
    expect(() => loadServerConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadServerConfig({ DATABASE_URL: 'x' })).toThrow(/BETTER_AUTH_SECRET/);
  });

  it('treats an empty value as absent', () => {
    expect(() => loadServerConfig({ ...MINIMAL, DATABASE_URL: '' })).toThrow(/DATABASE_URL/);
  });

  it('derives the issuer from the base URL plus the auth base path', () => {
    const config = loadServerConfig({ ...MINIMAL, SNIPPICK_BASE_URL: 'https://snippets.corp' });
    expect(config.issuer).toBe(`https://snippets.corp${AUTH_BASE_PATH}`);
    expect(config.resource).toBe('https://snippets.corp/v1');
  });

  it('strips trailing slashes so the issuer never doubles one', () => {
    const config = loadServerConfig({ ...MINIMAL, SNIPPICK_BASE_URL: 'https://snippets.corp///' });
    expect(config.baseUrl).toBe('https://snippets.corp');
  });

  /** A relative BASE_URL silently produces an empty issuer, and then no token ever verifies. */
  it('ignores a BASE_URL that is not an absolute http(s) URL', () => {
    expect(loadServerConfig({ ...MINIMAL, BASE_URL: '/' }).baseUrl).toBe('http://localhost:8787');
    expect(loadServerConfig({ ...MINIMAL, BASE_URL: 'ftp://host' }).baseUrl).toBe(
      'http://localhost:8787',
    );
  });

  it('prefers SNIPPICK_BASE_URL over the name other tools claim', () => {
    const config = loadServerConfig({
      ...MINIMAL,
      SNIPPICK_BASE_URL: 'https://ours.corp',
      BASE_URL: 'https://theirs.example',
    });
    expect(config.baseUrl).toBe('https://ours.corp');
  });

  it('parses the redirect URI list and falls back when it is blank', () => {
    expect(
      loadServerConfig({ ...MINIMAL, VSCODE_REDIRECT_URIS: 'a://one, b://two ' })
        .vscodeRedirectUris,
    ).toEqual(['a://one', 'b://two']);
    expect(
      loadServerConfig({ ...MINIMAL, VSCODE_REDIRECT_URIS: ' , ' }).vscodeRedirectUris,
    ).toEqual(loadServerConfig(MINIMAL).vscodeRedirectUris);
  });

  it('reads flags as 1/true and nothing else', () => {
    const read = (value: string | undefined) =>
      loadServerConfig({
        ...MINIMAL,
        ...(value === undefined ? {} : { ALLOW_DYNAMIC_CLIENT_REGISTRATION: value }),
      }).allowDynamicClientRegistration;
    expect(read('1')).toBe(true);
    expect(read('TRUE')).toBe(true);
    expect(read('0')).toBe(false);
    expect(read('yes')).toBe(false);
    expect(read(undefined)).toBe(false);
  });
});
