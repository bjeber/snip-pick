/**
 * Pure parser for the template syntax used by Snip Pick commands.
 *
 * - `{{name}}` / `{{name:default}}` — prompt the user, remembering the last value.
 * - `{{secret:NAME}}` — read `NAME` from SecretStorage.
 * - `${file}` and friends — editor built-ins, substituted silently.
 * - `\{{` and `\${` — escapes producing a literal `{{` / `${`.
 */

export const BUILTINS = [
  'file',
  'relativeFile',
  'fileBasename',
  'fileDirname',
  'workspaceFolder',
  'selectedText',
  'lineNumber',
] as const;

export type BuiltinName = (typeof BUILTINS)[number];

export type TemplateNode =
  | { kind: 'text'; value: string }
  | { kind: 'prompt'; name: string; defaultValue?: string }
  | { kind: 'secret'; name: string }
  | { kind: 'builtin'; name: BuiltinName };

export interface PromptPlaceholder {
  name: string;
  defaultValue?: string;
}

export interface Placeholders {
  prompts: PromptPlaceholder[];
  secrets: string[];
  builtins: BuiltinName[];
}

export interface TemplateValues {
  prompts?: Record<string, string>;
  secrets?: Record<string, string>;
  builtins?: Partial<Record<BuiltinName, string>>;
}

function isBuiltin(name: string): name is BuiltinName {
  return (BUILTINS as readonly string[]).includes(name);
}

function pushText(nodes: TemplateNode[], value: string): void {
  if (value.length === 0) return;
  const last = nodes[nodes.length - 1];
  if (last && last.kind === 'text') {
    last.value += value;
    return;
  }
  nodes.push({ kind: 'text', value });
}

/** Splits a template into literal text and placeholder nodes. Never throws. */
export function parseTemplate(input: string): TemplateNode[] {
  const nodes: TemplateNode[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input[index]!;

    if (char === '\\' && (input.startsWith('{{', index + 1) || input.startsWith('${', index + 1))) {
      pushText(nodes, input.slice(index + 1, index + 3));
      index += 3;
      continue;
    }

    if (input.startsWith('{{', index)) {
      const end = input.indexOf('}}', index + 2);
      if (end === -1) {
        pushText(nodes, input.slice(index));
        break;
      }
      const raw = input.slice(index + 2, end);
      const node = parsePlaceholder(raw);
      if (node) {
        nodes.push(node);
      } else {
        pushText(nodes, input.slice(index, end + 2));
      }
      index = end + 2;
      continue;
    }

    if (input.startsWith('${', index)) {
      const end = input.indexOf('}', index + 2);
      if (end !== -1) {
        const name = input.slice(index + 2, end).trim();
        if (isBuiltin(name)) {
          nodes.push({ kind: 'builtin', name });
          index = end + 1;
          continue;
        }
      }
      // Not one of ours (e.g. a shell `${VAR}`): leave it untouched.
      pushText(nodes, input.slice(index, index + 2));
      index += 2;
      continue;
    }

    pushText(nodes, char);
    index += 1;
  }

  return nodes;
}

function parsePlaceholder(raw: string): TemplateNode | undefined {
  const separator = raw.indexOf(':');
  if (separator === -1) {
    const name = raw.trim();
    return name.length > 0 ? { kind: 'prompt', name } : undefined;
  }
  const head = raw.slice(0, separator).trim();
  const tail = raw.slice(separator + 1);
  if (head === 'secret') {
    const name = tail.trim();
    return name.length > 0 ? { kind: 'secret', name } : undefined;
  }
  if (head.length === 0) return undefined;
  return { kind: 'prompt', name: head, defaultValue: tail };
}

/** Collects the distinct placeholders of a template, in order of first appearance. */
export function collectPlaceholders(nodes: readonly TemplateNode[]): Placeholders {
  const prompts: PromptPlaceholder[] = [];
  const secrets: string[] = [];
  const builtins: BuiltinName[] = [];
  for (const node of nodes) {
    if (node.kind === 'prompt') {
      const existing = prompts.find((entry) => entry.name === node.name);
      if (!existing) {
        prompts.push(
          node.defaultValue === undefined
            ? { name: node.name }
            : { name: node.name, defaultValue: node.defaultValue },
        );
      } else if (existing.defaultValue === undefined && node.defaultValue !== undefined) {
        existing.defaultValue = node.defaultValue;
      }
    } else if (node.kind === 'secret') {
      if (!secrets.includes(node.name)) secrets.push(node.name);
    } else if (node.kind === 'builtin') {
      if (!builtins.includes(node.name)) builtins.push(node.name);
    }
  }
  return { prompts, secrets, builtins };
}

/** Substitutes values into parsed nodes. Missing values fall back to defaults, then to `''`. */
export function renderTemplate(
  nodes: readonly TemplateNode[],
  values: TemplateValues = {},
): string {
  let out = '';
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        out += node.value;
        break;
      case 'prompt':
        out += values.prompts?.[node.name] ?? node.defaultValue ?? '';
        break;
      case 'secret':
        out += values.secrets?.[node.name] ?? '';
        break;
      case 'builtin':
        out += values.builtins?.[node.name] ?? '';
        break;
    }
  }
  return out;
}

/** Convenience wrapper over {@link parseTemplate} + {@link renderTemplate}. */
export function resolveTemplate(input: string, values: TemplateValues = {}): string {
  return renderTemplate(parseTemplate(input), values);
}
