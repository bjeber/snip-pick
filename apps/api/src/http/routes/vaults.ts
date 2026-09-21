import { Hono } from 'hono';
import type { AuthedEnv } from '@snip-pick/auth-verify';
import { requireAccessToken } from '../../guard';
import { listVaultsForUser } from '../../vaults/service';

export const vaultRoutes = new Hono<AuthedEnv>()
  .use('*', requireAccessToken)

  /** Who the access token belongs to. */
  .get('/me', (c) => {
    const token = c.get('token');
    return c.json({ userId: token.subject, scopes: token.scopes, clientId: token.clientId });
  })

  /**
   * Every vault the caller can reach, across every tenant. The extension mounts the ones the
   * user picks as additional roots in its tree, beside the local files.
   */
  .get('/vaults', async (c) => {
    const vaults = await listVaultsForUser(c.get('token').subject);
    return c.json({ vaults });
  });
