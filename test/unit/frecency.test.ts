import { describe, expect, it } from 'vitest';
import { decay, frecency, HALF_LIFE_MS } from '../../src/context/frecency';

const now = 10 * HALF_LIFE_MS;

describe('decay', () => {
  it('is 1 for something used right now', () => {
    expect(decay(now, now)).toBe(1);
  });

  it('halves every half-life', () => {
    expect(decay(now - HALF_LIFE_MS, now)).toBeCloseTo(0.5, 10);
    expect(decay(now - 2 * HALF_LIFE_MS, now)).toBeCloseTo(0.25, 10);
  });

  it('never exceeds 1 for clock skew', () => {
    expect(decay(now + 5_000, now)).toBe(1);
  });
});

describe('frecency', () => {
  it('is zero without usage', () => {
    expect(frecency(undefined, now)).toBe(0);
    expect(frecency({ uses: 0, lastUsed: now }, now)).toBe(0);
  });

  it('weights count by recency', () => {
    const fresh = frecency({ uses: 2, lastUsed: now }, now);
    const stale = frecency({ uses: 2, lastUsed: now - HALF_LIFE_MS }, now);
    expect(fresh).toBe(2);
    expect(stale).toBeCloseTo(1, 10);
  });

  it('lets a much-used old item beat a barely-used fresh one', () => {
    const old = frecency({ uses: 40, lastUsed: now - 2 * HALF_LIFE_MS }, now);
    const fresh = frecency({ uses: 1, lastUsed: now }, now);
    expect(old).toBeGreaterThan(fresh);
  });
});
