import { describe, expect, it, vi } from 'vitest';
import { DiscoveryError, describeServer, normalizeBaseUrl } from '../src/discovery';

const metadata = {
  issuer: 'https://snips.acme.test/api/auth',
  authorization_endpoint: 'https://snips.acme.test/api/auth/oauth2/authorize',
  token_endpoint: 'https://snips.acme.test/api/auth/oauth2/token',
};

function fakeFetch(routes: Record<string, unknown>, status = 200) {
  return vi.fn(async (url: string) => {
    const body = routes[url];
    if (body === undefined) {
      return new Response('not found', { status: 404 });
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
}

describe('normalizeBaseUrl', () => {
  it('assumes https when no scheme is given', () => {
    expect(normalizeBaseUrl('snips.acme.test')).toBe('https://snips.acme.test');
  });

  it('keeps an explicit scheme, including http for local development', () => {
    expect(normalizeBaseUrl('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('strips trailing slashes and whitespace but keeps a path prefix', () => {
    expect(normalizeBaseUrl('  https://acme.test/snips/  ')).toBe('https://acme.test/snips');
  });

  it('rejects nonsense', () => {
    expect(() => normalizeBaseUrl('http://')).toThrow(DiscoveryError);
  });
});

describe('describeServer', () => {
  it('reads the metadata and the resource identifier', async () => {
    const fetchImpl = fakeFetch({
      'https://snips.acme.test/.well-known/oauth-authorization-server': metadata,
      'https://snips.acme.test/.well-known/oauth-protected-resource': {
        resource: 'https://snips.acme.test/v1',
      },
    });
    const description = await describeServer('snips.acme.test', fetchImpl);
    expect(description.baseUrl).toBe('https://snips.acme.test');
    expect(description.metadata.token_endpoint).toBe(metadata.token_endpoint);
    expect(description.resource).toBe('https://snips.acme.test/v1');
  });

  it('derives the resource when the optional document is absent', async () => {
    const fetchImpl = fakeFetch({
      'https://snips.acme.test/.well-known/oauth-authorization-server': metadata,
    });
    const description = await describeServer('https://snips.acme.test', fetchImpl);
    expect(description.resource).toBe('https://snips.acme.test/v1');
  });

  it('explains an unreachable server rather than leaking a fetch error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(describeServer('https://down.test', fetchImpl)).rejects.toThrow(
      /Could not reach .*ECONNREFUSED/,
    );
  });

  it('rejects a URL that answers with something that is not an authorization server', async () => {
    const fetchImpl = fakeFetch({
      'https://snips.acme.test/.well-known/oauth-authorization-server': { issuer: 'x' },
    });
    await expect(describeServer('https://snips.acme.test', fetchImpl)).rejects.toThrow(
      /does not look like an OAuth authorization server/,
    );
  });

  it('reports a non-200 from the metadata endpoint', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }));
    await expect(describeServer('https://snips.acme.test', fetchImpl)).rejects.toThrow(/500/);
  });
});
