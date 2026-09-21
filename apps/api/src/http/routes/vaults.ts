import { Hono } from 'hono';
import type { VaultPush } from '@snip-pick/contracts';
import type { AuthedEnv } from '@snip-pick/auth-verify';
import { requireAccessToken } from '../../guard';
import { listVaultsForUser } from '../../vaults/service';
import { applyPush, canAccessVault, pullDelta, VaultValidationError } from '../../vaults/sync';

/** Reads `?since=`, rejecting anything that is not a whole number of revisions. */
function since(raw: string | undefined): number | undefined {
  if (raw === undefined) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function isPush(body: unknown): body is VaultPush {
  if (typeof body !== 'object' || body === null) return false;
  const push = body as Record<string, unknown>;
  return (
    Number.isInteger(push.baseRevision) &&
    Array.isArray(push.items) &&
    Array.isArray(push.groups) &&
    Array.isArray(push.deletedItems) &&
    Array.isArray(push.deletedGroups)
  );
}

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
  })

  /**
   * What changed since a revision. `?since=0`, the default, is the whole vault.
   *
   * 404 rather than 403 when the caller may not reach the vault: which vault ids exist in a
   * tenant is not something an outsider should be able to probe for.
   */
  .get('/vaults/:id/delta', async (c) => {
    const vaultId = c.req.param('id');
    const from = since(c.req.query('since'));
    if (from === undefined) {
      return c.json({ error: 'invalid_request', error_description: 'since must be >= 0' }, 400);
    }
    if (!(await canAccessVault(c.get('token').subject, vaultId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    return c.json(await pullDelta(vaultId, from));
  })

  /**
   * Offers local changes. Answers 409 with the colliding entities when both sides moved, and
   * writes nothing in that case — the decision is the person's to make in their editor.
   */
  .post('/vaults/:id/delta', async (c) => {
    const vaultId = c.req.param('id');
    if (!(await canAccessVault(c.get('token').subject, vaultId))) {
      return c.json({ error: 'not_found' }, 404);
    }
    const body = await c.req.json().catch(() => undefined);
    if (!isPush(body)) {
      return c.json({ error: 'invalid_request', error_description: 'malformed push' }, 400);
    }
    try {
      const result = await applyPush(vaultId, body);
      return c.json(result, result.conflicts.length > 0 ? 409 : 200);
    } catch (error) {
      if (error instanceof VaultValidationError) {
        return c.json({ error: 'invalid_request', error_description: error.message }, 422);
      }
      throw error;
    }
  });
