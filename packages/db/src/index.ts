/**
 * Postgres schema, client and migrations.
 *
 * Server-only: this package pulls in `pg` and `drizzle-orm`, and nothing the extension can reach
 * may import it. The lint config enforces that, and the extension's build asserts it.
 */

export * from './auth-schema';
export * from './schema';
export * from './client';
export * from './migrate';
