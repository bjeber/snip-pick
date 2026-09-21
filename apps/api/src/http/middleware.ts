import { decodeProtectedHeader, jwtVerify } from 'jose';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import { env } from '../env';
import { keySet } from './jwks';

export interface AccessTokenClaims {
  subject: string;
  scopes: string[];
  clientId?: string;
}

export type AuthedEnv = {
  Variables: {
    token: AccessTokenClaims;
  };
};

function bearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return undefined;
  return value.trim();
}

/** RFC 6750 / RFC 9728 challenge, pointing the client at this resource's metadata. */
function challenge(c: Context<AuthedEnv>, error: string, description: string): Response {
  const parameters = [
    `realm="${env.resource}"`,
    `error="${error}"`,
    `error_description="${description.replace(/"/g, "'")}"`,
    `resource_metadata="${env.baseUrl}/.well-known/oauth-protected-resource"`,
  ].join(', ');
  return c.json(
    { error, error_description: description },
    error === 'invalid_request' ? 400 : 401,
    { 'WWW-Authenticate': `Bearer ${parameters}` },
  );
}

/**
 * Resource-server guard. Verifies the access token's signature, issuer and audience, so a token
 * minted by this server for a *different* resource cannot be replayed here (RFC 8707).
 *
 * Failures answer with an RFC 6750 `WWW-Authenticate` challenge, which is what lets a client tell
 * "refresh my token" apart from "you may not do this".
 */
export const requireAccessToken = createMiddleware<AuthedEnv>(async (c, next) => {
  const token = bearer(c.req.header('authorization'));
  if (!token) {
    return challenge(c, 'invalid_request', 'A bearer access token is required.');
  }

  try {
    const header = decodeProtectedHeader(token);
    const keys = await keySet(header.kid);
    const { payload } = await jwtVerify(token, keys, {
      issuer: env.issuer,
      audience: env.resource,
    });
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new Error('token has no subject');
    }
    const scope = typeof payload.scope === 'string' ? payload.scope : '';
    c.set('token', {
      subject: payload.sub,
      scopes: scope.split(' ').filter((entry) => entry.length > 0),
      ...(typeof payload.client_id === 'string' ? { clientId: payload.client_id } : {}),
    });
  } catch (error) {
    return challenge(c, 'invalid_token', (error as Error).message);
  }

  await next();
  return undefined;
});
