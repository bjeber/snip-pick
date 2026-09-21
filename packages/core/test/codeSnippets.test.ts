import { describe, expect, it } from 'vitest';
import {
  itemsToCodeSnippets,
  parseCodeSnippets,
  snippetsToItems,
} from '../src/importers/codeSnippets';
import { makeItem } from './helpers';

const FILE = `{
  // A console logger
  "Print to console": {
    "scope": "javascript, typescript",
    "prefix": "log",
    "body": ["console.log('$1');", "$0"],
    "description": "Log output to console"
  },
  "Plain": {
    "prefix": ["p", "plain"],
    "body": "just one line"
  }
}`;

describe('parseCodeSnippets', () => {
  it('reads prefix, body, description and scope', () => {
    const { snippets, errors } = parseCodeSnippets(FILE);
    expect(errors).toEqual([]);
    expect(snippets[0]).toEqual({
      name: 'Print to console',
      prefix: 'log',
      body: "console.log('$1');\n$0",
      description: 'Log output to console',
      languages: ['javascript', 'typescript'],
    });
  });

  it('takes the first of several prefixes and leaves scope out when absent', () => {
    const { snippets } = parseCodeSnippets(FILE);
    expect(snippets[1]).toEqual({ name: 'Plain', prefix: 'p', body: 'just one line' });
  });

  it('collects per-snippet problems without failing the whole file', () => {
    const { snippets, errors } = parseCodeSnippets(
      '{ "good": { "body": "x" }, "bad": { "prefix": "y" }, "worse": 5 }',
    );
    expect(snippets.map((snippet) => snippet.name)).toEqual(['good']);
    expect(errors).toHaveLength(2);
  });

  it('rejects input that is not a snippet object', () => {
    expect(parseCodeSnippets('[1,2]').errors).toHaveLength(1);
    expect(parseCodeSnippets('nope').errors).toHaveLength(1);
  });
});

describe('snippetsToItems', () => {
  it('maps scope to context languages and keeps the prefix', () => {
    let counter = 0;
    const items = snippetsToItems(parseCodeSnippets(FILE).snippets, {
      newId: () => `id-${(counter += 1)}`,
      groupId: 'g1',
      now: 42,
    });
    expect(items[0]).toEqual({
      id: 'id-1',
      type: 'snippet',
      title: 'Print to console',
      body: "console.log('$1');\n$0",
      description: 'Log output to console',
      prefix: 'log',
      groupId: 'g1',
      tags: [],
      context: { languages: ['javascript', 'typescript'] },
      createdAt: 42,
      updatedAt: 42,
    });
  });

  it('leaves groupId out when no group was chosen', () => {
    const items = snippetsToItems([{ name: 'A', body: 'b' }], { newId: () => 'x' });
    expect(items[0]).not.toHaveProperty('groupId');
  });
});

describe('itemsToCodeSnippets', () => {
  it('writes scope, prefix, body lines and description', () => {
    const text = itemsToCodeSnippets([
      makeItem({
        title: 'Guard',
        body: 'if (!x) {\n  return;\n}',
        prefix: 'guard',
        description: 'Early return',
        context: { languages: ['typescript'] },
      }),
    ]);
    expect(JSON.parse(text)).toEqual({
      Guard: {
        scope: 'typescript',
        prefix: 'guard',
        body: ['if (!x) {', '  return;', '}'],
        description: 'Early return',
      },
    });
    expect(text.endsWith('\n')).toBe(true);
  });

  it('falls back to the title as prefix and skips commands', () => {
    const text = itemsToCodeSnippets([
      makeItem({ title: 'Snip', body: 'x' }),
      makeItem({ title: 'Cmd', type: 'command', body: 'ls' }),
    ]);
    const parsed = JSON.parse(text) as Record<string, { prefix: string }>;
    expect(Object.keys(parsed)).toEqual(['Snip']);
    expect(parsed.Snip?.prefix).toBe('Snip');
  });

  it('disambiguates duplicate titles', () => {
    const text = itemsToCodeSnippets([
      makeItem({ title: 'Same', body: 'a' }),
      makeItem({ title: 'Same', body: 'b' }),
    ]);
    expect(Object.keys(JSON.parse(text))).toEqual(['Same', 'Same (2)']);
  });

  it('round-trips an export back through the importer', () => {
    const original = makeItem({
      title: 'Guard',
      body: 'if (!x) return;',
      prefix: 'guard',
      context: { languages: ['typescript'] },
    });
    const { snippets } = parseCodeSnippets(itemsToCodeSnippets([original]));
    expect(snippets[0]).toMatchObject({
      name: 'Guard',
      prefix: 'guard',
      body: 'if (!x) return;',
      languages: ['typescript'],
    });
  });
});
