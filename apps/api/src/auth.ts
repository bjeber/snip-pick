import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, organization } from 'better-auth/plugins';
import { db, schema } from './db/client';
import { env } from './env';

/**
 * The API is its own authorization server.
 *
 * That is the whole point of the deployment model: a company runs this at an internal URL, and
 * the editor talks OAuth 2.1 to it directly. No third-party IdP is required, and nothing
 * long-lived ever gets pasted into a settings file.
 */
export const auth = betterAuth({
  appName: 'Snip Pick',
  baseURL: env.baseUrl,
  basePath: '/api/auth',
  secret: env.authSecret,
  database: drizzleAdapter(db, { provider: 'pg', schema }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    // Signs access and ID tokens, and serves the JWKS the API verifies them against.
    jwt(),
    // Tenants. Teams back project vaults, so membership and invitations are not reinvented.
    organization({
      teams: { enabled: true },
    }),
    oauthProvider({
      loginPage: '/sign-in',
      consentPage: '/consent',
      // Access tokens are audience-bound to this API (RFC 8707), so a token minted for another
      // resource cannot be replayed against it.
      resources: [env.resource],
      // Off unless a deployment opts in: the VS Code client is seeded at boot, so nothing needs
      // open registration in the normal case.
      allowDynamicClientRegistration: env.allowDynamicClientRegistration,
    }),
  ],
});

export type Auth = typeof auth;
