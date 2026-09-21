import { createLocalJWKSet, type JWTVerifyGetKey } from 'jose';
import { auth } from '../auth';

/**
 * Key set for verifying access tokens.
 *
 * Read in-process from the JWT plugin rather than over HTTP from our own `/jwks`: a container
 * usually cannot reach its own public BASE_URL, and a self-call would make token verification
 * depend on the network topology it is deployed into.
 */
interface KeySetCache {
  keys: JWTVerifyGetKey;
  ids: Set<string>;
  loadedAt: number;
}

/**
 * Floor between reloads triggered by an unknown `kid`.
 *
 * `kid` is read from the *unverified* token header, before any signature check, so anyone can ask
 * for one we have never seen. Without a floor, a stream of random `kid`s becomes one database
 * read per request. Rotation still propagates within this window.
 */
const RELOAD_INTERVAL_MS = 60_000;

let cached: KeySetCache | undefined;

async function load(now: number): Promise<KeySetCache> {
  const jwks = (await auth.api.getJwks()) as { keys: Array<Record<string, unknown>> };
  const ids = new Set(
    jwks.keys.map((key) => key.kid).filter((kid): kid is string => typeof kid === 'string'),
  );
  return {
    keys: createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]),
    ids,
    loadedAt: now,
  };
}

/** Returns the key set, refreshing on an unseen `kid` at most once per {@link RELOAD_INTERVAL_MS}. */
export async function keySet(
  kid: string | undefined,
  now: number = Date.now(),
): Promise<JWTVerifyGetKey> {
  if (!cached) {
    cached = await load(now);
    return cached.keys;
  }
  const unknownKid = kid !== undefined && !cached.ids.has(kid);
  if (unknownKid && now - cached.loadedAt >= RELOAD_INTERVAL_MS) {
    cached = await load(now);
  }
  // A still-unknown kid falls through: jwtVerify rejects it, which is the correct answer.
  return cached.keys;
}

/** Test seam: drops the cache so a rotated key is picked up immediately. */
export function resetKeySet(): void {
  cached = undefined;
}
