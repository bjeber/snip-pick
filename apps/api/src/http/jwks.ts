import { createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { auth } from '../auth';

/**
 * Key set for verifying access tokens.
 *
 * Read in-process from the JWT plugin rather than over HTTP from our own `/jwks`: a container
 * usually cannot reach its own public BASE_URL, and a self-call would make token verification
 * depend on the network topology it is deployed into.
 */
let cached: { keys: JWTVerifyGetKey; ids: Set<string> } | undefined;

async function load(): Promise<{ keys: JWTVerifyGetKey; ids: Set<string> }> {
  const jwks = (await auth.api.getJwks()) as { keys: Array<Record<string, unknown>> };
  const ids = new Set(
    jwks.keys.map((key) => key.kid).filter((kid): kid is string => typeof kid === 'string'),
  );
  return { keys: createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]), ids };
}

/** Returns the key set, refreshing it when `kid` is one we have not seen (key rotation). */
export async function keySet(kid: string | undefined): Promise<JWTVerifyGetKey> {
  if (!cached || (kid !== undefined && !cached.ids.has(kid))) {
    cached = await load();
  }
  return cached.keys;
}

/** Test seam: drops the cache so a rotated key is picked up immediately. */
export function resetKeySet(): void {
  cached = undefined;
}
