import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

/**
 * Where the generated SQL lives.
 *
 * Resolved against this module rather than the caller's working directory, so the app running the
 * migrations does not have to know how this package is laid out.
 *
 * fileURLToPath rather than URL.pathname: pathname keeps percent-encoding, so a checkout under a
 * directory with a space in it resolves to `/repo/my%20project/...`, and on Windows it yields
 * `/C:/...`. Neither is a path drizzle can open.
 */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../drizzle', import.meta.url));

/** Applies every migration in {@link MIGRATIONS_FOLDER}. */
export function runMigrations(db: Database): Promise<void> {
  return migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
