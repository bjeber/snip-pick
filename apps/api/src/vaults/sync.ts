import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  validateFile,
  type Group,
  type Item,
  type VaultConflict,
  type VaultDelta,
  type VaultPush,
  type VaultPushResult,
} from '@snip-pick/contracts';
import { member, team, teamMember, vault, vaultEntity } from '@snip-pick/db';
import { db } from '../db';

export class VaultAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VaultAccessError';
  }
}

export class VaultValidationError extends Error {
  constructor(readonly errors: string[]) {
    super(errors.join('; '));
    this.name = 'VaultValidationError';
  }
}

/**
 * Whether `userId` may read and write `vaultId`, by the same rule that decides which vaults they
 * are offered: a personal vault belongs to its owner, a project vault to the team behind it.
 *
 * Checked per request rather than inferred from the vault having been listed once. A team
 * membership can be revoked between a client's first sync and its next, and this is the only
 * thing standing between a stale mounted vault and the tenant's data.
 */
export async function canAccessVault(userId: string, vaultId: string): Promise<boolean> {
  const row = await db.query.vault.findFirst({ where: eq(vault.id, vaultId) });
  if (!row) return false;

  // Membership of the tenant is necessary either way; the vault's own rule is on top of it.
  const membership = await db.query.member.findFirst({
    where: and(eq(member.organizationId, row.organizationId), eq(member.userId, userId)),
    columns: { id: true },
  });
  if (!membership) return false;

  if (row.kind === 'personal') return row.ownerUserId === userId;
  if (!row.teamId) return false;
  const onTeam = await db
    .select({ id: teamMember.id })
    .from(teamMember)
    .innerJoin(team, eq(team.id, teamMember.teamId))
    .where(and(eq(teamMember.teamId, row.teamId), eq(teamMember.userId, userId)))
    .limit(1);
  return onTeam.length > 0;
}

function splitRows(
  rows: readonly (typeof vaultEntity.$inferSelect)[],
): Omit<VaultDelta, 'revision'> {
  const delta: Omit<VaultDelta, 'revision'> = {
    items: [],
    groups: [],
    deletedItems: [],
    deletedGroups: [],
  };
  for (const row of rows) {
    if (row.deleted || row.data === null) {
      if (row.kind === 'item') delta.deletedItems.push(row.entityId);
      else delta.deletedGroups.push(row.entityId);
      continue;
    }
    if (row.kind === 'item') delta.items.push(row.data as Item);
    else delta.groups.push(row.data as Group);
  }
  return delta;
}

/**
 * Everything that changed after `since`, plus the revision the caller is then up to date with.
 *
 * `since = 0` yields the whole vault, so a first sync and an incremental one are the same request
 * and there is no separate "download everything" path to keep in step.
 */
export async function pullDelta(vaultId: string, since: number): Promise<VaultDelta> {
  const row = await db.query.vault.findFirst({
    where: eq(vault.id, vaultId),
    columns: { revision: true },
  });
  if (!row) throw new VaultAccessError('No such vault.');

  const rows = await db
    .select()
    .from(vaultEntity)
    .where(and(eq(vaultEntity.vaultId, vaultId), gt(vaultEntity.revision, since)));

  return { revision: row.revision, ...splitRows(rows) };
}

/** The ids a push touches, as (kind, id) pairs. */
function touched(push: VaultPush): Array<{ kind: 'item' | 'group'; id: string }> {
  return [
    ...push.items.map((entity) => ({ kind: 'item' as const, id: entity.id })),
    ...push.deletedItems.map((id) => ({ kind: 'item' as const, id })),
    ...push.groups.map((entity) => ({ kind: 'group' as const, id: entity.id })),
    ...push.deletedGroups.map((id) => ({ kind: 'group' as const, id })),
  ];
}

/**
 * Rejects a push whose contents are not valid items and groups.
 *
 * Reuses the validator the editor writes its files through, so "what a snippet is" is defined
 * once. A vault is read back by other people's editors, and a malformed row would break their
 * tree rather than the sender's.
 */
function validate(push: VaultPush): void {
  const result = validateFile({ schemaVersion: 1, groups: push.groups, items: push.items });
  if (!result.ok) throw new VaultValidationError(result.errors);
}

/**
 * Applies a push, or reports what it collided with.
 *
 * All of it or none of it. A partial apply would move the vault's revision on while the client
 * still owed a decision about the rest, and every other client would then pull a state that
 * nobody had agreed to.
 *
 * The vault row is locked for the duration, which serialises concurrent pushes to one vault:
 * without it two clients can both read revision N, both find no conflict, and both write N+1.
 */
export async function applyPush(vaultId: string, push: VaultPush): Promise<VaultPushResult> {
  validate(push);

  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(vault).where(eq(vault.id, vaultId)).for('update');
    if (!current) throw new VaultAccessError('No such vault.');

    const ids = touched(push);
    if (ids.length === 0) return { revision: current.revision, applied: 0, conflicts: [] };

    const existing = await tx
      .select()
      .from(vaultEntity)
      .where(
        and(
          eq(vaultEntity.vaultId, vaultId),
          inArray(
            vaultEntity.entityId,
            ids.map((entry) => entry.id),
          ),
        ),
      );
    const byKey = new Map(existing.map((row) => [`${row.kind}:${row.entityId}`, row]));

    // Moved on the server since the client last had the whole vault: both sides changed it.
    const conflicts: VaultConflict[] = [];
    const mineOf = (kind: 'item' | 'group', id: string): Item | Group | null => {
      const source = kind === 'item' ? push.items : push.groups;
      return source.find((entity) => entity.id === id) ?? null;
    };
    for (const { kind, id } of ids) {
      const row = byKey.get(`${kind}:${id}`);
      if (!row || row.revision <= push.baseRevision) continue;
      const theirs = row.deleted ? null : (row.data ?? null);
      if (kind === 'item') {
        conflicts.push({
          kind,
          id,
          mine: mineOf(kind, id) as Item | null,
          theirs: theirs as Item | null,
        });
      } else {
        conflicts.push({
          kind,
          id,
          mine: mineOf(kind, id) as Group | null,
          theirs: theirs as Group | null,
        });
      }
    }
    if (conflicts.length > 0) {
      return { revision: current.revision, applied: 0, conflicts };
    }

    const revision = current.revision + 1;
    const now = new Date();
    const rows = [
      ...push.items.map((entity) => ({
        vaultId,
        kind: 'item' as const,
        entityId: entity.id,
        data: entity,
        revision,
        deleted: false,
        updatedAt: now,
      })),
      ...push.groups.map((entity) => ({
        vaultId,
        kind: 'group' as const,
        entityId: entity.id,
        data: entity,
        revision,
        deleted: false,
        updatedAt: now,
      })),
      ...push.deletedItems.map((id) => ({
        vaultId,
        kind: 'item' as const,
        entityId: id,
        data: null,
        revision,
        deleted: true,
        updatedAt: now,
      })),
      ...push.deletedGroups.map((id) => ({
        vaultId,
        kind: 'group' as const,
        entityId: id,
        data: null,
        revision,
        deleted: true,
        updatedAt: now,
      })),
    ];

    await tx
      .insert(vaultEntity)
      .values(rows)
      .onConflictDoUpdate({
        target: [vaultEntity.vaultId, vaultEntity.kind, vaultEntity.entityId],
        // The row being inserted wins: this is the write, and the conflict check above already
        // established that the client had seen whatever was there.
        set: {
          data: sql`excluded.data`,
          revision: sql`excluded.revision`,
          deleted: sql`excluded.deleted`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    await tx.update(vault).set({ revision, updatedAt: now }).where(eq(vault.id, vaultId));

    return { revision, applied: rows.length, conflicts: [] };
  });
}
