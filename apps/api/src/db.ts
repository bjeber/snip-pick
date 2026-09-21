import { createDb } from '@snip-pick/db';
import { config } from './config';

/**
 * The process-wide connection pool.
 *
 * Opened here, in the composition root, and passed down from there — see src/config.ts on why
 * the app may hold a singleton and the packages it wires together may not.
 */
export const { db, pool, close: closeDb } = createDb(config);
