import { oauthProvider } from '@better-auth/oauth-provider';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { jwt, organization } from 'better-auth/plugins';
import { AUTH_BASE_PATH } from '@snip-pick/config';
import { schema, type Database } from '@snip-pick/db';

/** The slice of the server configuration the authorization server needs. */
export interface AuthConfig {
  readonly baseUrl: string;
  readonly authSecret: string;
  readonly resource: string;
  readonly allowDynamicClientRegistration: boolean;
}

export interface AuthDeps {
  readonly db: Database;
  readonly config: AuthConfig;
}

/**
 * Builds the authorization server.
 *
 * The API is its own authorization server. That is the whole point of the deployment model: a
 * company runs this at an internal URL, and the editor talks OAuth 2.1 to it directly. No
 * third-party IdP is required, and nothing long-lived ever gets pasted into a settings file.
 *
 * A factory rather than a module-level instance: this reaches a database and signing keys, so
 * importing the package must not be enough to construct it.
 */
export function createAuth({ db, config }: AuthDeps) {
  return betterAuth({
    appName: 'Snip Pick',
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.authSecret,
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
        resources: [config.resource],
        // Off unless a deployment opts in: the VS Code client is seeded at boot, so nothing needs
        // open registration in the normal case.
        allowDynamicClientRegistration: config.allowDynamicClientRegistration,
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
