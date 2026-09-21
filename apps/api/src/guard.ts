import { createAccessTokenGuard } from '@snip-pick/auth-verify';
import { auth } from './auth';
import { config } from './config';

/**
 * The resource-server guard for /v1.
 *
 * `@snip-pick/auth-verify` asks for a function returning a JWK set rather than for the
 * authorization server, so reading the keys in-process is a decision that lives here: a container
 * usually cannot reach its own public BASE_URL, and a self-call would make token verification
 * depend on the network topology it is deployed into.
 */
export const requireAccessToken = createAccessTokenGuard({
  config,
  jwks: () => auth.api.getJwks() as Promise<{ keys: Array<Record<string, unknown>> }>,
});
