/**
 * Import and export of VS Code `.code-snippets` files. Pure: no `vscode` imports, so the
 * translation rules can be unit-tested on their own.
 */
import { parseJsonc } from '../model/jsonc';
import type { Item } from '@snip-pick/contracts';

export interface ParsedSnippet {
  /** The key in the `.code-snippets` object, used as the item title. */
  name: string;
  prefix?: string;
  body: string;
  description?: string;
  /** `scope` translated to VS Code languageIds. */
  languages?: string[];
}

export interface ParseSnippetsResult {
  snippets: ParsedSnippet[];
  errors: string[];
}

function joinBody(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && value.every((line) => typeof line === 'string')) {
    return value.join('\n');
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

function parseScope(value: unknown): string[] | undefined {
  const raw = firstString(value);
  if (raw === undefined) return undefined;
  const languages = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return languages.length > 0 ? languages : undefined;
}

/** Parses the contents of a `.code-snippets` (or `<lang>.json`) snippet file. */
export function parseCodeSnippets(text: string): ParseSnippetsResult {
  const errors: string[] = [];
  const parsed = parseJsonc<Record<string, unknown>>(text);
  if (parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { snippets: [], errors: ['The file is not a JSON object of snippet definitions.'] };
  }

  const snippets: ParsedSnippet[] = [];
  for (const [name, raw] of Object.entries(parsed)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors.push(`"${name}" is not a snippet definition.`);
      continue;
    }
    const definition = raw as Record<string, unknown>;
    const body = joinBody(definition.body);
    if (body === undefined) {
      errors.push(`"${name}" has no usable body.`);
      continue;
    }
    const snippet: ParsedSnippet = { name, body };
    const prefix = firstString(definition.prefix);
    if (prefix !== undefined) snippet.prefix = prefix;
    const description = firstString(definition.description);
    if (description !== undefined) snippet.description = description;
    const languages = parseScope(definition.scope);
    if (languages !== undefined) snippet.languages = languages;
    snippets.push(snippet);
  }

  return { snippets, errors };
}

export interface ToItemsOptions {
  groupId?: string;
  now?: number;
  newId: () => string;
  tags?: string[];
}

/** Turns parsed snippets into Snip Pick items. */
export function snippetsToItems(
  snippets: readonly ParsedSnippet[],
  options: ToItemsOptions,
): Item[] {
  const now = options.now ?? Date.now();
  return snippets.map((snippet) => {
    const item: Item = {
      id: options.newId(),
      type: 'snippet',
      title: snippet.name,
      body: snippet.body,
      tags: options.tags ? [...options.tags] : [],
      createdAt: now,
      updatedAt: now,
    };
    if (snippet.description) item.description = snippet.description;
    if (snippet.prefix) item.prefix = snippet.prefix;
    if (options.groupId !== undefined) item.groupId = options.groupId;
    if (snippet.languages?.length) item.context = { languages: [...snippet.languages] };
    return item;
  });
}

/** Serializes snippets back to the `.code-snippets` format, with a trailing newline. */
export function itemsToCodeSnippets(items: readonly Item[]): string {
  const out: Record<string, Record<string, unknown>> = {};
  const used = new Set<string>();
  for (const item of items) {
    if (item.type !== 'snippet') continue;
    let key = item.title;
    let suffix = 2;
    while (used.has(key)) {
      key = `${item.title} (${suffix})`;
      suffix += 1;
    }
    used.add(key);
    const definition: Record<string, unknown> = {};
    const languages = item.context?.languages;
    if (languages?.length) definition.scope = languages.join(',');
    definition.prefix = item.prefix ?? item.title;
    definition.body = item.body.split('\n');
    if (item.description) definition.description = item.description;
    out[key] = definition;
  }
  return `${JSON.stringify(out, null, 2)}\n`;
}
