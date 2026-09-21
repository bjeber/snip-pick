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

  /**
   * The resource and issuer are built by appending to the base URL, so a value that cannot be
   * appended to has to be rejected rather than normalised: `https://host?x=1` would otherwise
   * produce the resource `https://host?x=1/v1`.
   */
  it('rejects a base URL carrying a query, fragment or credentials', () => {
    for (const bad of ['https://host?x=1', 'https://host#frag', 'https://user:pw@host']) {
      expect(loadServerConfig({ ...MINIMAL, SNIPPICK_BASE_URL: bad }).baseUrl).toBe(
        'http://localhost:8787',
      );
    }
  });

  /** A reverse proxy mounting the API under a path is a real arrangement; keep the path. */
  it('keeps a base path', () => {
    const config = loadServerConfig({ ...MINIMAL, SNIPPICK_BASE_URL: 'https://host/snippick/' });
    expect(config.baseUrl).toBe('https://host/snippick');
    expect(config.resource).toBe('https://host/snippick/v1');
    expect(config.issuer).toBe(`https://host/snippick${AUTH_BASE_PATH}`);
  });

  describe('PORT', () => {
    const read = (value: string) => loadServerConfig({ ...MINIMAL, PORT: value }).port;

    it('defaults when unset or blank', () => {
      expect(loadServerConfig(MINIMAL).port).toBe(8787);
      expect(read('')).toBe(8787);
    });

    /** 0 means "any free port"; the API's own test binds that way. */
    it('allows 0', () => {
      expect(read('0')).toBe(0);
    });

    it('rejects anything that is not a port, at load rather than at serve()', () => {
      for (const bad of ['abc', '8787.5', '-1', '65536', '8787abc']) {
        expect(() => read(bad), bad).toThrow(/PORT/);
      }
    });

    /** Number() accepts these spellings and they land on real ports, so they are not errors. */
    it('accepts the odd spellings Number() understands', () => {
      expect(read('1e4')).toBe(10000);
      expect(read(' 8080 ')).toBe(8080);
    });
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
