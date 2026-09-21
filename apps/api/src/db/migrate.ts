import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client';

/** Applies everything in drizzle/ and exits. Run it before starting the server. */
async function main(): Promise<void> {
  await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  await pool.end();
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
