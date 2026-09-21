/** Configuration, read once and validated loudly rather than failing deep inside a request. */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required environment variable ${name}. See apps/api/.env.example.`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

function list(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  const entries = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : fallback;
}

function flag(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

/**
 * Absolute http(s) origin, or `undefined`.
 *
 * `BASE_URL` is a name other tools claim — Vite, for one, sets it to `"/"` — and a relative value
 * silently becomes an empty issuer, which every token then fails to verify against. Anything that
 * is not an absolute URL is ignored rather than trusted.
 */
function absoluteUrl(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (!value) continue;
    try {
      const url = new URL(value);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return value.replace(/\/+$/, '');
      }
    } catch {
      // Not a URL at all; fall through to the next candidate.
    }
  }
  return undefined;
}

const baseUrl = absoluteUrl('SNIPPICK_BASE_URL', 'BASE_URL') ?? 'http://localhost:8787';

/** better-auth mounts at this path, and the OAuth issuer is the base URL *plus* that path. */
export const AUTH_BASE_PATH = '/api/auth';

export const env = {
  databaseUrl: required('DATABASE_URL'),
  authSecret: required('BETTER_AUTH_SECRET'),
  baseUrl,
  port: Number(optional('PORT', '8787')),
  /**
   * RFC 8707 resource identifier. Access tokens are bound to it, so a token minted for another
   * service cannot be replayed here.
   */
  resource: `${baseUrl}/v1`,
  /**
   * The `iss` value access tokens carry. Note this is not the bare base URL: better-auth issues
   * under its own base path, and a resource server that checks the wrong one rejects every
   * otherwise-valid token.
   */
  issuer: `${baseUrl}${AUTH_BASE_PATH}`,
  vscodeRedirectUris: list('VSCODE_REDIRECT_URIS', [
    'vscode://bieber.snip-pick/auth',
    'https://vscode.dev/redirect',
  ]),
  allowDynamicClientRegistration: flag('ALLOW_DYNAMIC_CLIENT_REGISTRATION'),
  isProduction: process.env.NODE_ENV === 'production',
} as const;

/** The client id the bundled VS Code extension authenticates as. */
export const VSCODE_CLIENT_ID = 'snip-pick-vscode';
