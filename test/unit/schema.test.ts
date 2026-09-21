import { describe, expect, it } from 'vitest';
import { migrate, parseFile, serializeFile, validateFile } from '../../src/model/schema';
import { makeFile, makeItem } from './helpers';

describe('parseFile', () => {
  it('treats empty text as an empty library', () => {
    const result = parseFile('   ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.items).toEqual([]);
  });

  it('reports invalid JSON', () => {
    const result = parseFile('{ nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/Invalid JSON/);
  });

  it('accepts a well-formed file and drops unknown keys', () => {
    const result = parseFile(
      JSON.stringify({
        schemaVersion: 1,
        groups: [{ id: 'g1', name: 'Group', order: 0, colour: 'red' }],
        items: [
          {
            id: 'i1',
            type: 'command',
            title: 'Build',
            body: 'npm run build',
            tags: ['ci'],
            createdAt: 1,
            updatedAt: 2,
            somethingElse: true,
          },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.groups[0]).toEqual({ id: 'g1', name: 'Group', order: 0 });
    expect(result.file.items[0]).not.toHaveProperty('somethingElse');
    expect(result.file.items[0]?.tags).toEqual(['ci']);
  });

  it('rejects an unsupported schemaVersion', () => {
    const result = validateFile({ schemaVersion: 99, groups: [], items: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/Unsupported schemaVersion/);
  });

  it('collects field-level errors with a path', () => {
    const result = validateFile({
      schemaVersion: 1,
      groups: [],
      items: [
        { id: 'i1', type: 'note', title: '', body: 1, tags: 'x', createdAt: 1, updatedAt: 1 },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContain('items[0].title must not be empty');
    expect(result.errors).toContain('items[0].body must be a string');
    expect(result.errors).toContain('items[0].tags must be an array of strings');
    expect(result.errors.some((error) => error.includes('items[0].type'))).toBe(true);
  });

  it('defaults timestamps when they are missing', () => {
    const result = validateFile({
      schemaVersion: 1,
      items: [{ id: 'i1', type: 'snippet', title: 'T', body: 'b' }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(typeof result.file.items[0]?.createdAt).toBe('number');
    expect(result.file.items[0]?.updatedAt).toBe(result.file.items[0]?.createdAt);
  });
});

describe('migrate', () => {
  it('stamps a schemaVersion onto a version-less file', () => {
    expect(migrate({ groups: [], items: [] })).toMatchObject({ schemaVersion: 1 });
  });

  it('leaves current files alone', () => {
    const file = { schemaVersion: 1, groups: [], items: [] };
    expect(migrate(file)).toEqual(file);
  });
});

describe('serializeFile', () => {
  it('writes a stable key order with two-space indent and a trailing newline', () => {
    const text = serializeFile(
      makeFile({
        groups: [{ id: 'g1', name: 'A', order: 0 }],
        items: [
          makeItem({
            id: 'i1',
            title: 'Zebra',
            tags: ['b', 'a'],
            pinned: true,
            context: { languages: ['ts'] },
          }),
        ],
      }),
    );
    expect(text.endsWith('\n')).toBe(true);
    expect(text).toContain('\n  "groups": [');
    const parsed = JSON.parse(text) as { items: Array<Record<string, unknown>> };
    expect(Object.keys(parsed.items[0]!)).toEqual([
      'id',
      'type',
      'title',
      'body',
      'tags',
      'context',
      'pinned',
      'createdAt',
      'updatedAt',
    ]);
  });

  it('round-trips through parseFile', () => {
    const file = makeFile({ items: [makeItem({ description: 'hi', prefix: 'p' })] });
    const result = parseFile(serializeFile(file));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file).toEqual(file);
  });

  it('omits empty optional fields', () => {
    const text = serializeFile(makeFile({ items: [makeItem({ description: '', steps: [] })] }));
    expect(text).not.toContain('description');
    expect(text).not.toContain('steps');
  });
});
