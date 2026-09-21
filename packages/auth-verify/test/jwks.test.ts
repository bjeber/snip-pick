import { describe, expect, it } from 'vitest';
import { createKeySetReader, RELOAD_INTERVAL_MS, type JwksSource } from '../src/jwks';

const KEY = {
  kty: 'EC',
  crv: 'P-256',
  x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
  y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
  alg: 'ES256',
};

/** A source that counts calls and only settles when told to. */
function gatedSource(kid = 'a') {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const source: JwksSource = async () => {
    calls += 1;
    await gate;
    return { keys: [{ ...KEY, kid }] };
  };
  return { source, release, calls: () => calls };
}

describe('createKeySetReader', () => {
  it('loads once for concurrent callers on a cold cache', async () => {
    const { source, release, calls } = gatedSource();
    const reader = createKeySetReader(source);

    const pending = [reader.keySet('a'), reader.keySet('a'), reader.keySet('a')];
    // All three are waiting on the same load; none has been able to populate the cache yet.
    expect(calls()).toBe(1);

    release();
    const sets = await Promise.all(pending);
    expect(calls()).toBe(1);
    expect(new Set(sets).size).toBe(1);
  });

  it('loads once for a burst of unknown kids past the reload floor', async () => {
    let calls = 0;
    const source: JwksSource = async () => {
      calls += 1;
      return { keys: [{ ...KEY, kid: 'known' }] };
    };
    const reader = createKeySetReader(source);
    await reader.keySet('known', 0);
    expect(calls).toBe(1);

    const later = RELOAD_INTERVAL_MS;
    await Promise.all(Array.from({ length: 20 }, (_, i) => reader.keySet(`unknown-${i}`, later)));
    expect(calls).toBe(2);
  });

  it('serves the cached set without reloading inside the floor', async () => {
    let calls = 0;
    const source: JwksSource = async () => {
      calls += 1;
      return { keys: [{ ...KEY, kid: 'known' }] };
    };
    const reader = createKeySetReader(source);
    await reader.keySet('known', 0);
    await reader.keySet('unknown', RELOAD_INTERVAL_MS - 1);
    expect(calls).toBe(1);
  });

  it('does not wedge after a failed load', async () => {
    let calls = 0;
    const source: JwksSource = async () => {
      calls += 1;
      if (calls === 1) throw new Error('jwks unavailable');
      return { keys: [{ ...KEY, kid: 'a' }] };
    };
    const reader = createKeySetReader(source);
    await expect(reader.keySet('a')).rejects.toThrow('jwks unavailable');
    await expect(reader.keySet('a')).resolves.toBeTypeOf('function');
    expect(calls).toBe(2);
  });

  it('reset drops the cache', async () => {
    let calls = 0;
    const source: JwksSource = async () => {
      calls += 1;
      return { keys: [{ ...KEY, kid: 'a' }] };
    };
    const reader = createKeySetReader(source);
    await reader.keySet('a', 0);
    reader.reset();
    await reader.keySet('a', 0);
    expect(calls).toBe(2);
  });
});
