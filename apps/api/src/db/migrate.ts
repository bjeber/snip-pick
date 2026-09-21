import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

/** Applies everything in drizzle/ and exits. Run it before starting the server. */
async function main(): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  } finally {
    // An open pool socket keeps the event loop alive, so a failed migration would hang instead
    // of exiting with its non-zero code.
    await pool.end();
  }
}

main().then(
  () => {
    process.stdout.write('Migrations applied.\n');
  },
  (error: unknown) => {
    process.stderr.write(`Migration failed: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
