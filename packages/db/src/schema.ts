import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Group, Item } from '@snip-pick/contracts';
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

/**
 * The contents of every vault: one row per item or group, in the shape the clients exchange.
 *
 * One table rather than one per kind. The two differ only in what sits in `data`, and a delta is
 * a single scan of this table rather than two that have to be stitched back together in revision
 * order.
 *
 * `revision` is the vault revision the row was last written at, which is what `?since=` compares
 * against. It is the server's counter, so it orders writes from machines whose clocks do not
 * agree — the `updatedAt` inside `data` cannot, because whichever editor made the change stamped
 * it.
 *
 * A delete sets `deleted` and clears `data` rather than removing the row. Without the tombstone a
 * client cannot tell "deleted" from "not yet sent", and would offer every deletion back on its
 * next push.
 */
export const vaultEntity = pgTable(
  'vault_entity',
  {
    vaultId: text('vault_id')
      .notNull()
      .references(() => vault.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['item', 'group'] }).notNull(),
    entityId: text('entity_id').notNull(),
    /** Null exactly when `deleted`. */
    data: jsonb('data').$type<Item | Group>(),
    revision: bigint('revision', { mode: 'number' }).notNull(),
    deleted: boolean('deleted').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.vaultId, table.kind, table.entityId] }),
    // The delta query: everything in one vault above a revision, in revision order.
    index('vault_entity_delta_idx').on(table.vaultId, table.revision),
  ],
);

export type VaultEntityRow = typeof vaultEntity.$inferSelect;
export type NewVaultEntityRow = typeof vaultEntity.$inferInsert;
