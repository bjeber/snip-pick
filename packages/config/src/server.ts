/**
 * Server configuration, read from the environment and validated loudly rather than failing deep
 * inside a request.
 *
 * `loadServerConfig` is a function, not a module-level constant, and it never reads `process.env`
 * on its own initiative. Importing this package therefore cannot throw and cannot bind a process
 * to one environment — which is what lets the packages that consume it be imported by a test, a
 * migration script or drizzle-kit without a full deployment's worth of variables being set.
 */

/** Values read from the environment. `process.env` by default; anything map-like in a test. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

function required(source: EnvSource, name: string): string {
  const value = source[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}. See apps/api/.env.example.`);
  }
  return value;
}

function list(source: EnvSource, name: string, fallback: string[]): string[] {
  const value = source[name];
  if (!value) return fallback;
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : fallback;
}

function flag(source: EnvSource, name: string, fallback = false): boolean {
  const value = source[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Absolute http(s) base URL, or `undefined`.
 *
 * `BASE_URL` is a name other tools claim — Vite, for one, sets it to `"/"` — and a relative value
 * silently becomes an empty issuer, which every token then fails to verify against. Anything that
 * is not an absolute URL is ignored rather than trusted.
 *
 * The resource and issuer are built by appending to this, so anything that cannot be appended to
 * is rejected as well: `https://host?x=1` would otherwise yield the resource
 * `https://host?x=1/v1`, and every token would be minted for an audience no client can name.
 *
 * A path is allowed and kept. A deployment behind a reverse proxy at `https://host/snippick` is
 * a real arrangement, and `https://host/snippick/v1` is the right answer for it.
 */
function absoluteUrl(source: EnvSource, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = source[name];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (url.search || url.hash || url.username || url.password) continue;
      return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    } catch {
      // Not a URL at all; fall through to the next candidate.
    }
  }
  return undefined;
}

/**
 * TCP port, validated here rather than deep inside `serve()`.
 *
 * 0 is allowed and means "any free port": the API's own test binds that way to avoid colliding
 * with whatever else is running.
 */
function port(source: EnvSource, name: string, fallback: number): number {
  const raw = source[name];
  if (raw === undefined || raw.length === 0) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`${name} must be an integer between 0 and 65535, not ${JSON.stringify(raw)}.`);
  }
  return value;
}

/** better-auth mounts at this path, and the OAuth issuer is the base URL *plus* that path. */
export const AUTH_BASE_PATH = '/api/auth';

/** The client id the bundled VS Code extension authenticates as. */
export const VSCODE_CLIENT_ID = 'snip-pick-vscode';

export interface ServerConfig {
  readonly databaseUrl: string;
  readonly authSecret: string;
  readonly baseUrl: string;
  readonly port: number;
  /**
   * RFC 8707 resource identifier. Access tokens are bound to it, so a token minted for another
   * service cannot be replayed here.
   */
  readonly resource: string;
  /**
   * The `iss` value access tokens carry. Note this is not the bare base URL: better-auth issues
   * under its own base path, and a resource server that checks the wrong one rejects every
   * otherwise-valid token.
   */
  readonly issuer: string;
  readonly vscodeRedirectUris: readonly string[];
  readonly allowDynamicClientRegistration: boolean;
  readonly isProduction: boolean;
}

/** Reads and validates the whole configuration. Throws on the first missing required value. */
export function loadServerConfig(source: EnvSource = process.env): ServerConfig {
  const baseUrl = absoluteUrl(source, 'SNIPPICK_BASE_URL', 'BASE_URL') ?? 'http://localhost:8787';

  return {
    databaseUrl: required(source, 'DATABASE_URL'),
    authSecret: required(source, 'BETTER_AUTH_SECRET'),
    baseUrl,
    port: port(source, 'PORT', 8787),
    resource: `${baseUrl}/v1`,
    issuer: `${baseUrl}${AUTH_BASE_PATH}`,
    vscodeRedirectUris: list(source, 'VSCODE_REDIRECT_URIS', [
      'vscode://bieber.snip-pick/auth',
      // VS Code Insiders uses its own URI scheme, and asExternalUri tunnels through vscode.dev
      // under Remote SSH, Codespaces and the web build. Redirect URIs are matched exactly.
      'vscode-insiders://bieber.snip-pick/auth',
      'https://vscode.dev/redirect',
    ]),
    allowDynamicClientRegistration: flag(source, 'ALLOW_DYNAMIC_CLIENT_REGISTRATION'),
    isProduction: source.NODE_ENV === 'production',
  };
}
