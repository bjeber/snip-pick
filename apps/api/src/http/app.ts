import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authServerMetadata } from '@snip-pick/auth';
import { AUTH_BASE_PATH as BASE_PATH } from '@snip-pick/config';
import { auth } from '../auth';
import { config } from '../config';
import { consentPage, signInPage } from './pages';
import { vaultRoutes } from './routes/vaults';

export function createApp(): Hono {
  const app = new Hono();

  app.use(
    '/v1/*',
    cors({
      origin: '*',
      allowHeaders: ['authorization', 'content-type'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );

  app.get('/health', (c) => c.json({ ok: true, issuer: config.issuer, resource: config.resource }));

  /**
   * RFC 8414 requires the metadata document at the origin root, which `basePath` would otherwise
   * hide under /api/auth. Serving it here is what lets a client discover a deployment from
   * nothing but the URL a user typed.
   */
  const metadata = authServerMetadata(auth);
  app.get('/.well-known/oauth-authorization-server', (c) => metadata(c.req.raw));
  app.get('/.well-known/openid-configuration', (c) => metadata(c.req.raw));

  /** RFC 9728: tells a client which authorization server guards this resource. */
  app.get('/.well-known/oauth-protected-resource', (c) =>
    c.json({
      resource: config.resource,
      authorization_servers: [config.issuer],
      bearer_methods_supported: ['header'],
      scopes_supported: ['openid', 'profile', 'email', 'offline_access'],
    }),
  );

  app.get('/sign-in', (c) => c.html(signInPage('Snip Pick', BASE_PATH)));

  app.get('/consent', (c) => {
    const scope = c.req.query('scope') ?? '';
    const clientId = c.req.query('client_id') ?? 'an application';
    return c.html(consentPage(clientId, scope.split(' ').filter(Boolean), BASE_PATH));
  });

  app.route('/v1', vaultRoutes);

  // better-auth owns everything under its base path: sessions, organizations and the whole
  // OAuth surface (/oauth2/authorize, /oauth2/token, /oauth2/register, /jwks, …).
  app.on(['GET', 'POST'], `${BASE_PATH}/*`, (c) => auth.handler(c.req.raw));

  return app;
}
