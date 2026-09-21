import { describe, expect, it } from 'vitest';
import { pruneUsage, recordUse } from '../../src/store/usage';

describe('recordUse', () => {
  it('starts a counter for an unseen item', () => {
    expect(recordUse({}, 'a', 500)).toEqual({ a: { uses: 1, lastUsed: 500 } });
  });

  it('increments and refreshes the timestamp', () => {
    const first = recordUse({}, 'a', 500);
    expect(recordUse(first, 'a', 900)).toEqual({ a: { uses: 2, lastUsed: 900 } });
  });

  it('leaves the input untouched', () => {
    const usage = { a: { uses: 1, lastUsed: 1 } };
    recordUse(usage, 'a', 2);
    expect(usage.a.uses).toBe(1);
  });
});

describe('pruneUsage', () => {
  it('keeps only known ids', () => {
    const usage = { a: { uses: 1, lastUsed: 1 }, b: { uses: 2, lastUsed: 2 } };
    expect(pruneUsage(usage, ['b'])).toEqual({ b: { uses: 2, lastUsed: 2 } });
  });
});
