import { createAuth } from '@snip-pick/auth';
import { config } from './config';
import { db } from './db';

/**
 * The process-wide authorization server.
 *
 * Built here, in the composition root, from the two things it needs: the pool this app opened
 * and the configuration this app read. See src/config.ts on why that arrangement is the app's
 * job rather than any package's.
 */
export const auth = createAuth({ db, config });
