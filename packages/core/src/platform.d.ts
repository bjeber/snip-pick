/**
 * The entire platform surface this package depends on.
 *
 * Declared by hand rather than pulling in `lib.dom` or `@types/node`: both would make hundreds of
 * globals available, and the point of this package is that it runs anywhere. Reaching for a
 * second global should be a deliberate edit to this file, not something a stray import enables.
 */
declare global {
  var crypto: { randomUUID(): string };
}

export {};
