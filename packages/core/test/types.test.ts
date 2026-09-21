import { describe, expect, it } from 'vitest';
import { newId } from '../src/model/ids';
import { bodyPreview, commandText, emptyFile } from '../src/model/types';
import { makeItem } from './helpers';

describe('emptyFile', () => {
  it('starts at the current schema version', () => {
    expect(emptyFile()).toEqual({ schemaVersion: 1, groups: [], items: [] });
  });
});

describe('commandText', () => {
  it('uses the body when there are no steps', () => {
    expect(commandText({ body: 'npm test', steps: undefined })).toBe('npm test');
    expect(commandText({ body: 'npm test', steps: [] })).toBe('npm test');
  });

  it('joins a command chain with &&, ignoring the body', () => {
    expect(commandText({ body: 'ignored', steps: ['npm ci', 'npm test'] })).toBe(
      'npm ci && npm test',
    );
  });
});

describe('bodyPreview', () => {
  it('collapses whitespace to a single line', () => {
    expect(bodyPreview(makeItem({ body: 'if (x) {\n  go();\n}' }))).toBe('if (x) { go(); }');
  });

  it('truncates with an ellipsis', () => {
    expect(bodyPreview(makeItem({ body: 'x'.repeat(200) }), 10)).toBe(`${'x'.repeat(9)}…`);
  });

  it('leaves short bodies alone and previews chains', () => {
    expect(bodyPreview(makeItem({ body: 'ls' }))).toBe('ls');
    expect(bodyPreview(makeItem({ body: '', steps: ['a', 'b'] }))).toBe('a && b');
  });
});

describe('newId', () => {
  it('returns distinct UUIDs', () => {
    const first = newId();
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(newId()).not.toBe(first);
  });
});
