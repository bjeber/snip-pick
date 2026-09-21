import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * End-to-end authorization-code + PKCE flow against a real server and a real database.
 *
 * Skipped unless DATABASE_URL and BETTER_AUTH_SECRET are both set, so `npm run test:unit` stays
 * runnable without Postgres. Start one with `npm run db:up` from the repo root, then apply
 * `npm run db:migrate -w apps/api`.
 *
 * The secret must be the one the database was populated with: better-auth encrypts the JWKS
 * private key with it, so a mismatched secret fails to sign tokens rather than failing loudly up
 * front.
 */
const CONFIGURED = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);

describe.skipIf(!CONFIGURED)('OAuth 2.1 authorization code flow', () => {
  const CLIENT_ID = 'snip-pick-vscode';
  const REDIRECT = 'vscode://bieber.snip-pick/auth';

  let server: Server;
  let base: string;
  let closePool: () => Promise<void>;
  const jar = new Map<string, string>();

  beforeAll(async () => {
    process.env.PORT = '0';
    // Imported lazily: these modules read (and validate) the environment at import time.
    const { serve } = await import('@hono/node-server');
    const { createApp } = await import('../src/http/app');
    const { seedVsCodeClient } = await import('../src/bootstrap');
    const { pool } = await import('../src/db/client');
    closePool = () => pool.end();

    await seedVsCodeClient();
    server = await new Promise<Server>((resolve) => {
      const instance = serve({ fetch: createApp().fetch, port: 0 }, (info) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve(instance as Server);
      });
    });
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await closePool?.();
  });

  function cookieHeader(): string {
    return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(base + path, {
      ...init,
      redirect: 'manual',
      headers: {
        'content-type': 'application/json',
        // better-auth rejects state-changing calls without an Origin (CSRF protection).
        origin: base,
        cookie: cookieHeader(),
        ...(init.headers as Record<string, string> | undefined),
      },
    });
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const index = pair!.indexOf('=');
      jar.set(pair!.slice(0, index), pair!.slice(index + 1));
    }
    return response;
  }

  /** better-auth answers with a 302 for browsers and `{ redirect, url }` for fetch clients. */
  async function redirectTarget(response: Response): Promise<string | undefined> {
    const header = response.headers.get('location');
    if (header) return header;
    if (response.headers.get('content-type')?.includes('application/json')) {
      const body = (await response
        .clone()
        .json()
        .catch(() => ({}))) as {
        redirect?: boolean;
        url?: string;
      };
      if (body.redirect && typeof body.url === 'string') return body.url;
    }
    return undefined;
  }

  async function follow(query: URLSearchParams): Promise<URL> {
    let response = await call(`/api/auth/oauth2/authorize?${query}`);
    let location = await redirectTarget(response);
    for (let hop = 0; location && !location.startsWith(REDIRECT) && hop < 5; hop += 1) {
      const next = new URL(location, base);
      response = await call(next.pathname + next.search);
      location = await redirectTarget(response);
    }
    expect(location, 'the flow should end at the client redirect_uri').toBeDefined();
    return new URL(location!);
  }

  async function token(body: Record<string, string>): Promise<Response> {
    return call('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    });
  }

  const verifier = randomBytes(32).toString('base64url');
  const state = randomBytes(16).toString('base64url');
  let resource: string;
  let authorizeQuery: URLSearchParams;
  let accessToken: string;
  let refreshToken: string;

  it('serves discovery metadata at the origin root', async () => {
    const response = await fetch(`${base}/.well-known/oauth-authorization-server`);
    expect(response.ok).toBe(true);
    const metadata = (await response.json()) as Record<string, string>;
    expect(metadata.authorization_endpoint).toContain('/oauth2/authorize');
    expect(metadata.token_endpoint).toContain('/oauth2/token');

    const protectedResource = await fetch(`${base}/.well-known/oauth-protected-resource`);
    const document = (await protectedResource.json()) as { resource: string };
    resource = document.resource;
    expect(resource).toContain('/v1');
  });

  it('signs a user up and gives them a tenant with a team', async () => {
    const email = `test-${randomUUID().slice(0, 8)}@example.com`;
    const signUp = await call('/api/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple', name: 'Test' }),
    });
    expect(signUp.status, await signUp.clone().text()).toBe(200);

    const org = await call('/api/auth/organization/create', {
      method: 'POST',
      body: JSON.stringify({ name: 'Acme Corp', slug: `acme-${randomUUID().slice(0, 6)}` }),
    });
    expect(org.status, await org.clone().text()).toBe(200);
    const { id: organizationId } = (await org.json()) as { id: string };

    const team = await call('/api/auth/organization/create-team', {
      method: 'POST',
      body: JSON.stringify({ name: 'Platform', organizationId }),
    });
    expect(team.status, await team.clone().text()).toBe(200);
    const { id: teamId } = (await team.json()) as { id: string };

    // Creating a team does not join it, so the membership that gates the project vault has to
    // be made explicitly. (better-auth also auto-creates a default team named after the
    // organization, which the creator *is* on — hence two project vaults below.)
    const me = await call('/api/auth/get-session');
    const session = (await me.json()) as { user: { id: string } };
    const added = await call('/api/auth/organization/add-team-member', {
      method: 'POST',
      body: JSON.stringify({ teamId, userId: session.user.id }),
    });
    expect(added.status, await added.clone().text()).toBe(200);
  });

  it('issues an authorization code and preserves state', async () => {
    authorizeQuery = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid profile email offline_access',
      state,
      nonce: randomBytes(16).toString('base64url'),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource,
    });
    const redirected = await follow(authorizeQuery);
    expect(redirected.searchParams.get('state')).toBe(state);
    expect(redirected.searchParams.get('code')).toBeTruthy();
    // RFC 9207: the issuer comes back so a client cannot be tricked by a mixed-up server.
    expect(redirected.searchParams.get('iss')).toBeTruthy();
  });

  it('refuses a code exchanged with the wrong PKCE verifier', async () => {
    const redirected = await follow(authorizeQuery);
    const response = await token({
      grant_type: 'authorization_code',
      code: redirected.searchParams.get('code')!,
      redirect_uri: REDIRECT,
      client_id: CLIENT_ID,
      code_verifier: randomBytes(32).toString('base64url'),
    });
    expect(response.ok).toBe(false);
  });

  it('exchanges a code for an audience-bound access token', async () => {
    const redirected = await follow(authorizeQuery);
    const response = await token({
      grant_type: 'authorization_code',
      code: redirected.searchParams.get('code')!,
      redirect_uri: REDIRECT,
      client_id: CLIENT_ID,
      code_verifier: verifier,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const tokens = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      id_token: string;
    };
    expect(tokens.refresh_token, 'offline_access should yield a refresh token').toBeTruthy();
    expect(tokens.id_token, 'openid should yield an ID token').toBeTruthy();
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;

    const claims = JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString()) as {
      aud: string[];
      client_id: string;
      sub: string;
    };
    expect(claims.aud).toContain(resource);
    expect(claims.client_id).toBe(CLIENT_ID);
  });

  it('lists the caller and their vaults', async () => {
    const authorization = { authorization: `Bearer ${accessToken}` };

    const me = await fetch(`${base}/v1/me`, { headers: authorization });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { userId: string }).userId).toBeTruthy();

    const response = await fetch(`${base}/v1/vaults`, { headers: authorization });
    expect(response.status, await response.clone().text()).toBe(200);
    const { vaults } = (await response.json()) as {
      vaults: Array<{ kind: string; name: string; organization: { name: string } }>;
    };
    // One personal vault in the tenant, and one project vault per team they are actually on:
    // the organization's default team, plus Platform.
    expect(vaults.every((vault) => vault.organization.name === 'Acme Corp')).toBe(true);
    expect(vaults.filter((vault) => vault.kind === 'personal')).toHaveLength(1);
    expect(vaults.filter((vault) => vault.kind === 'project').map((vault) => vault.name)).toContain(
      'Platform',
    );
  });

  it('rejects missing, malformed and wrong-audience tokens', async () => {
    const anonymous = await fetch(`${base}/v1/vaults`);
    expect(anonymous.status).toBe(400);
    expect(anonymous.headers.get('www-authenticate')).toContain('Bearer');

    const garbage = await fetch(`${base}/v1/vaults`, {
      headers: { authorization: 'Bearer not.a.token' },
    });
    expect(garbage.status).toBe(401);
    expect(garbage.headers.get('www-authenticate')).toContain('invalid_token');
  });

  it('refreshes the access token', async () => {
    const response = await token({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const refreshed = (await response.json()) as { access_token: string };
    expect(refreshed.access_token).toBeTruthy();
    expect(refreshed.access_token).not.toBe(accessToken);
  });
});
