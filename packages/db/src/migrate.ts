import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Database } from './client';

/**
 * Where the generated SQL lives.
 *
 * Resolved against this module rather than the caller's working directory, so the app running the
 * migrations does not have to know how this package is laid out.
 */
export const MIGRATIONS_FOLDER = new URL('../drizzle', import.meta.url).pathname;

/** Applies every migration in {@link MIGRATIONS_FOLDER}. */
export function runMigrations(db: Database): Promise<void> {
  return migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}
