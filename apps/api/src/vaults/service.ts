import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import { member, organization, team, teamMember } from '../db/auth-schema';
import { vault, type VaultRow } from '../db/schema';

export interface VaultSummary {
  id: string;
  name: string;
  kind: 'personal' | 'project';
  revision: number;
  organization: { id: string; name: string; slug: string };
  teamId?: string;
}

function toSummary(row: VaultRow, org: { id: string; name: string; slug: string }): VaultSummary {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    revision: row.revision,
    organization: org,
    ...(row.teamId ? { teamId: row.teamId } : {}),
  };
}

/**
 * Returns the member's personal vault in `organizationId`, creating it on first use.
 *
 * Created lazily rather than at join time so that adding the feature to an existing tenant does
 * not need a backfill, and so a member who never opens the editor costs nothing.
 */
export async function ensurePersonalVault(
  organizationId: string,
  userId: string,
  name = 'My Vault',
): Promise<VaultRow> {
  const existing = await db.query.vault.findFirst({
    where: and(
      eq(vault.organizationId, organizationId),
      eq(vault.ownerUserId, userId),
      eq(vault.kind, 'personal'),
    ),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(vault)
    .values({ id: randomUUID(), organizationId, ownerUserId: userId, kind: 'personal', name })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  // Lost a race with a concurrent sign-in; the unique index held, so re-read.
  const row = await db.query.vault.findFirst({
    where: and(
      eq(vault.organizationId, organizationId),
      eq(vault.ownerUserId, userId),
      eq(vault.kind, 'personal'),
    ),
  });
  if (!row) throw new Error('Failed to create the personal vault.');
  return row;
}

/** Creates the project vault backing a team, if it does not have one yet. */
export async function ensureProjectVault(
  organizationId: string,
  teamId: string,
  name: string,
): Promise<VaultRow> {
  const existing = await db.query.vault.findFirst({
    where: and(eq(vault.organizationId, organizationId), eq(vault.teamId, teamId)),
  });
  if (existing) return existing;
  const [created] = await db
    .insert(vault)
    .values({ id: randomUUID(), organizationId, teamId, kind: 'project', name })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const row = await db.query.vault.findFirst({
    where: and(eq(vault.organizationId, organizationId), eq(vault.teamId, teamId)),
  });
  if (!row) throw new Error('Failed to create the project vault.');
  return row;
}

/**
 * Every vault the user can reach, across every tenant they belong to: their personal vault in
 * each, plus the project vault of each team they are on.
 *
 * Team membership is the access rule, deliberately — it is the one the organization already
 * manages through better-auth's invitations, so there is no second place to get it wrong.
 */
export async function listVaultsForUser(userId: string): Promise<VaultSummary[]> {
  const memberships = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));
  const organizationIds = [...new Set(memberships.map((row) => row.organizationId))];
  if (organizationIds.length === 0) return [];

  const organizations = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(inArray(organization.id, organizationIds));
  const organizationById = new Map(organizations.map((org) => [org.id, org]));

  const teams = await db
    .select({ id: team.id, name: team.name, organizationId: team.organizationId })
    .from(team)
    .innerJoin(teamMember, eq(teamMember.teamId, team.id))
    .where(eq(teamMember.userId, userId));

  const summaries: VaultSummary[] = [];
  for (const organizationId of organizationIds) {
    const org = organizationById.get(organizationId);
    if (!org) continue;
    summaries.push(toSummary(await ensurePersonalVault(organizationId, userId), org));
  }

  // Every team the user belongs to is a project, and every project has a vault. Creating it on
  // first listing means a team never has to be "set up" before its members can use it.
  for (const row of teams) {
    const org = organizationById.get(row.organizationId);
    if (!org) continue;
    summaries.push(toSummary(await ensureProjectVault(row.organizationId, row.id, row.name), org));
  }

  return summaries.sort(
    (a, b) =>
      a.organization.name.localeCompare(b.organization.name) ||
      a.kind.localeCompare(b.kind) ||
      a.name.localeCompare(b.name),
  );
}
