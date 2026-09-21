import { runMigrations } from '@snip-pick/db';
import { closeDb, db } from './db';

/** Applies everything in the db package's drizzle/ folder and exits. Run it before the server. */
async function main(): Promise<void> {
  try {
    await runMigrations(db);
  } finally {
    // An open pool socket keeps the event loop alive, so a failed migration would hang instead
    // of exiting with its non-zero code.
    await closeDb();
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
