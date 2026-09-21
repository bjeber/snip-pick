import { createLocalJWKSet, type JWTVerifyGetKey } from 'jose';

/**
 * Supplies the current JWK set.
 *
 * A function, not the authorization server itself: reading the keys in-process is a property of
 * how this happens to be deployed, not of what verification needs. Inverting it is what keeps
 * this package off better-auth and off the database — the app passes
 * `() => auth.api.getJwks()`.
 *
 * Read in-process rather than over HTTP from our own `/jwks`: a container usually cannot reach
 * its own public BASE_URL, and a self-call would make token verification depend on the network
 * topology it is deployed into.
 */
export type JwksSource = () => Promise<{ keys: Array<Record<string, unknown>> }>;

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
export const RELOAD_INTERVAL_MS = 60_000;

export interface KeySetReader {
  /** Returns the key set, refreshing on an unseen `kid` at most once per {@link RELOAD_INTERVAL_MS}. */
  keySet(kid: string | undefined, now?: number): Promise<JWTVerifyGetKey>;
  /** Test seam: drops the cache so a rotated key is picked up immediately. */
  reset(): void;
}

export function createKeySetReader(source: JwksSource): KeySetReader {
  let cached: KeySetCache | undefined;
  let inFlight: Promise<KeySetCache> | undefined;

  async function fetchKeys(now: number): Promise<KeySetCache> {
    const jwks = await source();
    const ids = new Set(
      jwks.keys.map((key) => key.kid).filter((kid): kid is string => typeof kid === 'string'),
    );
    return {
      keys: createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]),
      ids,
      loadedAt: now,
    };
  }

  /**
   * One load at a time.
   *
   * `cached` is only assigned once the await resolves, so without this every request arriving
   * during a load sees the same cold or stale cache and starts its own — which is the stampede
   * {@link RELOAD_INTERVAL_MS} exists to prevent, and the floor cannot stop it because no reload
   * has finished to move `loadedAt`. A rejection clears the slot too, so a failed load does not
   * wedge the reader.
   */
  function load(now: number): Promise<KeySetCache> {
    inFlight ??= fetchKeys(now).finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  return {
    async keySet(kid, now = Date.now()) {
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
    },
    reset() {
      cached = undefined;
      inFlight = undefined;
    },
  };
}
