/**
 * The authorization server: sessions, tenants, and the OAuth 2.1 surface the editor signs in
 * against.
 *
 * Server-only. Verifying a token that this server issued does not belong here — that is
 * `@snip-pick/auth-verify`, which needs no database.
 */

export * from './auth';
export * from './bootstrap';
export * from './metadata';
