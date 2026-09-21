import { describe, expect, it } from 'vitest';
import { base64UrlEncode, challengeFor, createPkcePair, randomString } from '../src/pkce';

describe('base64UrlEncode', () => {
  it('produces URL-safe output with no padding', () => {
    const encoded = base64UrlEncode(new Uint8Array([251, 255, 190, 255]));
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encoded).toBe('-_--_w');
  });

  it('handles an empty buffer', () => {
    expect(base64UrlEncode(new Uint8Array([]))).toBe('');
  });
});

describe('randomString', () => {
  it('is URL-safe and long enough for a PKCE verifier', () => {
    const value = randomString(32);
    // RFC 7636 requires 43–128 characters; 32 bytes base64url is exactly 43.
    expect(value).toHaveLength(43);
    expect(value).toMatch(/^[A-Za-z0-9\-_]+$/);
  });

  it('does not repeat', () => {
    const values = new Set(Array.from({ length: 50 }, () => randomString()));
    expect(values.size).toBe(50);
  });
});

describe('challengeFor', () => {
  it('matches the RFC 7636 appendix B test vector', async () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    await expect(challengeFor(verifier)).resolves.toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('is deterministic', async () => {
    const [a, b] = await Promise.all([challengeFor('abc'), challengeFor('abc')]);
    expect(a).toBe(b);
    expect(await challengeFor('abd')).not.toBe(a);
  });
});

describe('createPkcePair', () => {
  it('derives the challenge from the verifier with S256', async () => {
    const pair = await createPkcePair();
    expect(pair.method).toBe('S256');
    expect(pair.challenge).toBe(await challengeFor(pair.verifier));
    expect(pair.challenge).not.toBe(pair.verifier);
  });
});
