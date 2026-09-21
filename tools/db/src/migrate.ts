import { createDb, runMigrations } from '@snip-pick/db';
import { describeTarget, localConfig } from './config';

/**
 * Applies the db package's migrations to the local container.
 *
 * apps/api has a migration entry point of its own, and that one is what a deployment runs: it
 * takes the configuration the server was started with and nothing else. This one exists because
 * a development database should not need a signing secret or a base URL to have its schema
 * created — only a connection string, which this fills in for you.
 */
async function main(): Promise<void> {
  const config = localConfig();
  const { db, close } = createDb(config);
  process.stdout.write(`Migrating ${describeTarget(config.databaseUrl)}\n`);
  try {
    await runMigrations(db);
  } finally {
    // An open pool socket keeps the event loop alive, so a failed migration would hang here
    // instead of exiting with its non-zero code.
    await close();
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
