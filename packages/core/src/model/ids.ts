/**
 * Indirection so tests can generate deterministic ids.
 *
 * `globalThis.crypto` rather than `node:crypto`: this package has to run in a web extension host
 * as well as in Node, and the Web Crypto API is the one both provide (Node >= 19).
 */
export function newId(): string {
  return globalThis.crypto.randomUUID();
}
