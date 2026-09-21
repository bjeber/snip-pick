import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Item, VaultPush } from '@snip-pick/contracts';
// Type-only, so it is erased: importing the module for real would open the pool at load time,
// which is what the skip below is guarding against.
import type * as VaultSync from '../src/vaults/sync';

/**
 * Vault sync against a real database.
 *
 * Skipped unless DATABASE_URL and BETTER_AUTH_SECRET are both set, so `pnpm run test:unit` stays
 * runnable without Postgres. `pnpm run db:reset` from the repo root gives you one, migrated.
 *
 * The service layer rather than HTTP: what is worth pinning down here is revision bookkeeping,
 * tombstones and conflict detection, and those are the same however the request arrived.
 */
const CONFIGURED = Boolean(process.env.DATABASE_URL && process.env.BETTER_AUTH_SECRET);

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    type: 'command',
    title: id,
    body: `echo ${id}`,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function push(baseRevision: number, overrides: Partial<VaultPush> = {}): VaultPush {
  return {
    baseRevision,
    items: [],
    groups: [],
    deletedItems: [],
    deletedGroups: [],
    ...overrides,
  };
}

describe.skipIf(!CONFIGURED)('vault sync', () => {
  let sync: typeof VaultSync;
  let closePool: () => Promise<void>;
  let vaultId: string;
  let userId: string;
  let organizationId: string;
  let strangerId: string;

  beforeAll(async () => {
    // Lazily, like the OAuth test: the composition root reads the environment and opens the pool
    // at import time, which is what the skip above is guarding.
    const { createAuth } = await import('@snip-pick/auth');
    const { config } = await import('../src/config');
    const { db, closeDb } = await import('../src/db');
    const { ensurePersonalVault } = await import('../src/vaults/service');
    sync = await import('../src/vaults/sync');
    closePool = closeDb;

    const auth = createAuth({ db, config });
    const suffix = randomUUID().slice(0, 8);
    const owner = await auth.api.signUpEmail({
      body: {
        name: 'Sync Owner',
        email: `sync-${suffix}@example.com`,
        password: 'correct-horse-battery-staple',
      },
    });
    userId = owner.user.id;
    const stranger = await auth.api.signUpEmail({
      body: {
        name: 'Stranger',
        email: `stranger-${suffix}@example.com`,
        password: 'correct-horse-battery-staple',
      },
    });
    strangerId = stranger.user.id;

    const org = await auth.api.createOrganization({
      body: { name: 'Sync Corp', slug: `sync-${suffix}`, userId },
    });
    organizationId = org!.id;
    vaultId = (await ensurePersonalVault(organizationId, userId)).id;
  }, 60_000);

  afterAll(async () => {
    if (!closePool) return;
    const { organization, user } = await import('@snip-pick/db');
    const { db } = await import('../src/db');
    const { eq, inArray } = await import('drizzle-orm');
    // The vault and its entities cascade from the organization.
    if (organizationId) await db.delete(organization).where(eq(organization.id, organizationId));
    const ids = [userId, strangerId].filter(Boolean);
    if (ids.length > 0) await db.delete(user).where(inArray(user.id, ids));
    await closePool();
  });

  it('starts empty, at revision zero', async () => {
    const delta = await sync.pullDelta(vaultId, 0);
    expect(delta.revision).toBe(0);
    expect(delta.items).toEqual([]);
    expect(delta.deletedItems).toEqual([]);
  });

  it('applies a push and moves the revision on', async () => {
    const result = await sync.applyPush(vaultId, push(0, { items: [item('a'), item('b')] }));
    expect(result.conflicts).toEqual([]);
    expect(result.applied).toBe(2);
    expect(result.revision).toBe(1);

    const delta = await sync.pullDelta(vaultId, 0);
    expect(delta.revision).toBe(1);
    expect(delta.items.map((entry) => entry.id).sort()).toEqual(['a', 'b']);
  });

  it('gives back only what changed after a revision', async () => {
    await sync.applyPush(vaultId, push(1, { items: [item('c')] }));

    const everything = await sync.pullDelta(vaultId, 0);
    expect(everything.items.map((entry) => entry.id).sort()).toEqual(['a', 'b', 'c']);

    const incremental = await sync.pullDelta(vaultId, 1);
    expect(incremental.items.map((entry) => entry.id)).toEqual(['c']);
    expect(incremental.revision).toBe(2);
  });

  it('reports a delete as a tombstone rather than an absence', async () => {
    const result = await sync.applyPush(vaultId, push(2, { deletedItems: ['b'] }));
    expect(result.conflicts).toEqual([]);

    const delta = await sync.pullDelta(vaultId, 2);
    expect(delta.deletedItems).toEqual(['b']);
    // A client that pulls from scratch must be told too, or it would re-create what it never had.
    const fromScratch = await sync.pullDelta(vaultId, 0);
    expect(fromScratch.deletedItems).toEqual(['b']);
    expect(fromScratch.items.map((entry) => entry.id).sort()).toEqual(['a', 'c']);
  });

  it('refuses a push whose base is behind, and writes nothing', async () => {
    const current = await sync.pullDelta(vaultId, 0);
    const theirs = item('a', { title: 'changed by them', updatedAt: 50 });
    await sync.applyPush(vaultId, push(current.revision, { items: [theirs] }));

    // A client that had not seen that write offers its own version of the same item.
    const mine = item('a', { title: 'changed by me', updatedAt: 60 });
    const result = await sync.applyPush(vaultId, push(current.revision, { items: [mine] }));

    expect(result.applied).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({ kind: 'item', id: 'a' });
    expect((result.conflicts[0]!.mine as Item).title).toBe('changed by me');
    expect((result.conflicts[0]!.theirs as Item).title).toBe('changed by them');

    // Nothing was written: the vault still holds their version.
    const after = await sync.pullDelta(vaultId, 0);
    expect(after.items.find((entry) => entry.id === 'a')?.title).toBe('changed by them');
  });

  it('accepts the same push once the client has caught up', async () => {
    const current = await sync.pullDelta(vaultId, 0);
    const mine = item('a', { title: 'changed by me', updatedAt: 60 });
    const result = await sync.applyPush(vaultId, push(current.revision, { items: [mine] }));

    expect(result.conflicts).toEqual([]);
    const after = await sync.pullDelta(vaultId, 0);
    expect(after.items.find((entry) => entry.id === 'a')?.title).toBe('changed by me');
  });

  it('rejects contents that are not valid items', async () => {
    await expect(
      sync.applyPush(vaultId, push(99, { items: [{ id: 'bad' } as unknown as Item] })),
    ).rejects.toThrow(sync.VaultValidationError);
  });

  it('lets the owner in and keeps everyone else out', async () => {
    expect(await sync.canAccessVault(userId, vaultId)).toBe(true);
    // A real user of the server, but not of this tenant or this personal vault.
    expect(await sync.canAccessVault(strangerId, vaultId)).toBe(false);
    expect(await sync.canAccessVault(userId, randomUUID())).toBe(false);
  });
});
