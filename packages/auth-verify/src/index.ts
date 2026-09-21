/**
 * The resource-server half of OAuth: checking that a presented access token is one this API
 * should honour.
 *
 * Deliberately separate from `@snip-pick/auth`. Verifying a token needs a JWK set, an issuer and
 * an audience — not a database, not better-auth and not the ability to mint anything. Keeping
 * that surface small means a request path that only reads tokens does not load the authorization
 * server to do it.
 */

export * from './jwks';
export * from './middleware';
