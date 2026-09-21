import { fileURLToPath } from 'node:url';
import { loadServerConfig, type ServerConfig } from '@snip-pick/config';

/** The API's own .env, if the developer has one. Resolved against this file, not the cwd. */
const API_ENV_FILE = fileURLToPath(new URL('../../../apps/api/.env', import.meta.url));

/**
 * What the container in this folder's compose.yaml is reachable at, and the rest of the
 * configuration the API would read.
 *
 * These are the values in apps/api/.env.example, repeated so that `pnpm run db:seed` works on a
 * fresh clone with nothing set up. They are the weakest source: apps/api/.env beats them, and the
 * real environment beats that. BETTER_AUTH_SECRET is why the precedence matters — better-auth
 * encrypts its JWKS private key with it, and a database populated under one secret cannot sign
 * tokens under another.
 */
const LOCAL_DEFAULTS: Record<string, string> = {
  DATABASE_URL: 'postgres://snippick:snippick@localhost:55432/snippick',
  BETTER_AUTH_SECRET: 'change-me-in-production',
  SNIPPICK_BASE_URL: 'http://localhost:8787',
};

/**
 * The same loader the API uses, so these scripts cannot drift from it, fed defaults rather than
 * being handed a second hand-rolled notion of what a connection string looks like.
 */
export function localConfig(): ServerConfig {
  // Not tsx's --env-file-if-exists: that prints a notice every run, and not having an .env is
  // the normal case here. loadEnvFile leaves variables already in the environment alone, so the
  // precedence in the comment above holds.
  try {
    process.loadEnvFile(API_ENV_FILE);
  } catch {
    // No .env. The defaults below describe the container in this folder, which is the point.
  }
  return loadServerConfig({ ...LOCAL_DEFAULTS, ...process.env });
}

/** Where a script is about to write, with the password removed so it can be printed. */
export function describeTarget(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return databaseUrl;
  }
}
