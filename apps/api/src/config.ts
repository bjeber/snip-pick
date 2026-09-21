import { loadServerConfig } from '@snip-pick/config';

/**
 * The process-wide configuration.
 *
 * An app is a composition root and may hold a singleton; the packages it wires together may not.
 * They take what they need as arguments, so importing one never reads the environment and never
 * throws on a variable that a test or a migration script has no reason to set.
 */
export const config = loadServerConfig();
