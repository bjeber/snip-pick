/**
 * PKCE (RFC 7636) primitives.
 *
 * A desktop client cannot keep a client secret, so it registers as a public client — and the
 * authorization server then *requires* PKCE from it. This is the whole reason the extension never
 * needs an API key.
 *
 * Built on WebCrypto so the same code runs in Node, a browser and a web extension host. The
 * dependency is declared structurally rather than as the DOM `Crypto` type, so consumers do not
 * have to pull `lib.dom` in to use this.
 */

export interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  subtle: { digest(algorithm: string, data: ArrayBufferView): Promise<ArrayBuffer> };
}

const webCrypto = (): CryptoLike => globalThis.crypto as unknown as CryptoLike;

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Cryptographically random, URL-safe string. `byteLength` 32 gives a 43-character value. */
export function randomString(byteLength = 32, crypto: CryptoLike = webCrypto()): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function challengeFor(
  verifier: string,
  crypto: CryptoLike = webCrypto(),
): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function createPkcePair(crypto: CryptoLike = webCrypto()): Promise<PkcePair> {
  const verifier = randomString(32, crypto);
  return { verifier, challenge: await challengeFor(verifier, crypto), method: 'S256' };
}
