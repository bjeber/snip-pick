import { relations, sql } from 'drizzle-orm';
import { bigint, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { organization, team, user } from './auth-schema';

/**
 * A vault is the unit of snippet storage, and the remote counterpart of a local
 * `snippick.json` file.
 *
 * Two kinds live side by side inside a tenant:
 * - `personal` — one per member, private to them. `ownerUserId` set, `teamId` null.
 * - `project`  — shared, backed by a better-auth team so membership and invitations are the
 *   ones the organization already manages. `teamId` set, `ownerUserId` null.
 *
 * `revision` is a per-vault counter bumped on every write. Clients pull deltas with
 * `?since=<revision>`, which is what keeps sync incremental and clock-independent.
 */
export const vault = pgTable(
  'vault',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['personal', 'project'] }).notNull(),
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vault_organization_idx').on(table.organizationId),
    // One personal vault per member per tenant: two employers, two vaults, no bleed.
    uniqueIndex('vault_personal_unique')
      .on(table.organizationId, table.ownerUserId)
      .where(sql`${table.kind} = 'personal'`),
    // A team backs at most one project vault.
    uniqueIndex('vault_project_unique')
      .on(table.organizationId, table.teamId)
      .where(sql`${table.kind} = 'project'`),
  ],
);

export const vaultRelations = relations(vault, ({ one }) => ({
  organization: one(organization, {
    fields: [vault.organizationId],
    references: [organization.id],
  }),
  team: one(team, { fields: [vault.teamId], references: [team.id] }),
  owner: one(user, { fields: [vault.ownerUserId], references: [user.id] }),
}));

export type VaultRow = typeof vault.$inferSelect;
export type NewVaultRow = typeof vault.$inferInsert;
