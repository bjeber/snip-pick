import { oauthProviderAuthServerMetadata } from '@better-auth/oauth-provider';
import type { Auth } from './auth';

/**
 * Handler for the RFC 8414 authorization-server metadata document.
 *
 * Re-exposed here so the app that mounts it does not have to depend on better-auth directly:
 * which library implements the authorization server is this package's business.
 */
export function authServerMetadata(auth: Auth) {
  return oauthProviderAuthServerMetadata(auth);
}
