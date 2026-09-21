import { describe, expect, it } from 'vitest';
import { newId } from '../src/model/ids';

describe('newId', () => {
  it('returns distinct UUIDs', () => {
    const first = newId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(first);
  });
});
