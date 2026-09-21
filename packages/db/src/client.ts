import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as authSchema from './auth-schema';
import * as appSchema from './schema';

/** The better-auth tables and ours, in one namespace — drizzle resolves relations across both. */
export const schema = { ...authSchema, ...appSchema };

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;

export interface DbConfig {
  readonly databaseUrl: string;
}

export interface DbHandle {
  readonly db: Database;
  readonly pool: pg.Pool;
  /** Releases the connections. An open pool socket keeps the event loop alive. */
  close(): Promise<void>;
}

/**
 * Opens a connection pool.
 *
 * A factory rather than a module-level `db`: a package that connects on import cannot be reached
 * by a unit test, a migration script or drizzle-kit without a live database behind it. The app
 * that owns the process calls this once and passes the handle down.
 */
export function createDb(config: DbConfig): DbHandle {
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
