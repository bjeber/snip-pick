import { describe, expect, it } from 'vitest';
import { parseJsonc, stripJsonComments } from '../../src/model/jsonc';

describe('stripJsonComments', () => {
  it('removes line and block comments', () => {
    expect(stripJsonComments('{ // hi\n "a": 1 /* there */ }')).toContain('"a": 1');
    expect(stripJsonComments('{ // hi\n "a": 1 }')).not.toContain('hi');
  });

  it('keeps comment-like text inside strings', () => {
    const text = '{ "url": "https://example.com", "path": "a/*b*/c" }';
    expect(parseJsonc<{ url: string; path: string }>(text)).toEqual({
      url: 'https://example.com',
      path: 'a/*b*/c',
    });
  });

  it('respects escaped quotes', () => {
    expect(parseJsonc<{ a: string }>('{ "a": "say \\"// hi\\"" }')).toEqual({ a: 'say "// hi"' });
  });

  it('removes trailing commas in objects and arrays', () => {
    expect(parseJsonc('{ "a": [1, 2,], }')).toEqual({ a: [1, 2] });
  });
});

describe('parseJsonc', () => {
  it('returns undefined for hopeless input', () => {
    expect(parseJsonc('{ nope')).toBeUndefined();
  });
});
