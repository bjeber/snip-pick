import {
  CURRENT_SCHEMA_VERSION,
  emptyFile,
  type Cwd,
  type Group,
  type Item,
  type ItemContext,
  type ItemType,
  type SnipPickFile,
} from './types';

export type ValidationResult = { ok: true; file: SnipPickFile } | { ok: false; errors: string[] };

const ITEM_TYPES: readonly ItemType[] = ['snippet', 'command'];
const CWDS: readonly Cwd[] = ['workspace', 'fileDir'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown, path: string, errors: string[]): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    errors.push(`${path} must be an array of strings`);
    return undefined;
  }
  return value as string[];
}

function requireString(
  value: unknown,
  path: string,
  errors: string[],
  { allowEmpty = false } = {},
): string | undefined {
  if (typeof value !== 'string') {
    errors.push(`${path} must be a string`);
    return undefined;
  }
  if (!allowEmpty && value.length === 0) {
    errors.push(`${path} must not be empty`);
    return undefined;
  }
  return value;
}

function optionalString(value: unknown, path: string, errors: string[]): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path, errors, { allowEmpty: true });
}

function validateContext(value: unknown, path: string, errors: string[]): ItemContext | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const context: ItemContext = {};
  const languages = stringArray(value.languages, `${path}.languages`, errors);
  const globs = stringArray(value.globs, `${path}.globs`, errors);
  const markers = stringArray(value.markers, `${path}.markers`, errors);
  if (languages) context.languages = languages;
  if (globs) context.globs = globs;
  if (markers) context.markers = markers;
  return context;
}

function validateGroup(value: unknown, index: number, errors: string[]): Group | undefined {
  const path = `groups[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, errors);
  const name = requireString(value.name, `${path}.name`, errors);
  const parentId =
    value.parentId === undefined
      ? undefined
      : requireString(value.parentId, `${path}.parentId`, errors);
  let order = 0;
  if (typeof value.order === 'number' && Number.isFinite(value.order)) {
    order = value.order;
  } else if (value.order !== undefined) {
    errors.push(`${path}.order must be a number`);
  }
  if (id === undefined || name === undefined) return undefined;
  const group: Group = { id, name, order };
  if (parentId !== undefined) group.parentId = parentId;
  return group;
}

function validateItem(value: unknown, index: number, errors: string[]): Item | undefined {
  const path = `items[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return undefined;
  }
  const id = requireString(value.id, `${path}.id`, errors);
  const title = requireString(value.title, `${path}.title`, errors);
  const body = requireString(value.body, `${path}.body`, errors, { allowEmpty: true });
  const type = value.type;
  if (typeof type !== 'string' || !ITEM_TYPES.includes(type as ItemType)) {
    errors.push(`${path}.type must be one of ${ITEM_TYPES.join(', ')}`);
  }
  const description = optionalString(value.description, `${path}.description`, errors);
  const prefix = optionalString(value.prefix, `${path}.prefix`, errors);
  const groupId =
    value.groupId === undefined
      ? undefined
      : requireString(value.groupId, `${path}.groupId`, errors);
  const tags =
    value.tags === undefined ? [] : (stringArray(value.tags, `${path}.tags`, errors) ?? []);
  const context = validateContext(value.context, `${path}.context`, errors);
  let cwd: Cwd | undefined;
  if (value.cwd !== undefined) {
    if (typeof value.cwd === 'string' && CWDS.includes(value.cwd as Cwd)) {
      cwd = value.cwd as Cwd;
    } else {
      errors.push(`${path}.cwd must be one of ${CWDS.join(', ')}`);
    }
  }
  if (value.confirm !== undefined && typeof value.confirm !== 'boolean') {
    errors.push(`${path}.confirm must be a boolean`);
  }
  if (value.pinned !== undefined && typeof value.pinned !== 'boolean') {
    errors.push(`${path}.pinned must be a boolean`);
  }
  const steps = stringArray(value.steps, `${path}.steps`, errors);
  const now = Date.now();
  const createdAt = typeof value.createdAt === 'number' ? value.createdAt : now;
  const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : createdAt;

  if (id === undefined || title === undefined || body === undefined) return undefined;
  if (typeof type !== 'string' || !ITEM_TYPES.includes(type as ItemType)) return undefined;

  const item: Item = {
    id,
    type: type as ItemType,
    title,
    body,
    tags,
    createdAt,
    updatedAt,
  };
  if (description !== undefined) item.description = description;
  if (prefix !== undefined) item.prefix = prefix;
  if (groupId !== undefined) item.groupId = groupId;
  if (context !== undefined) item.context = context;
  if (cwd !== undefined) item.cwd = cwd;
  if (typeof value.confirm === 'boolean') item.confirm = value.confirm;
  if (steps !== undefined) item.steps = steps;
  if (typeof value.pinned === 'boolean') item.pinned = value.pinned;
  return item;
}

/**
 * Brings older files up to {@link CURRENT_SCHEMA_VERSION}. A no-op for v1, but the plumbing is
 * here so that a future v2 has an obvious place to live.
 */
export function migrate(data: unknown): unknown {
  if (!isRecord(data)) return data;
  const version = typeof data.schemaVersion === 'number' ? data.schemaVersion : 0;
  let current: Record<string, unknown> = data;
  if (version < 1) {
    current = { ...current, schemaVersion: 1 };
  }
  return current;
}

/** Validates an already-parsed value. Unknown keys are dropped, structural errors are collected. */
export function validateFile(data: unknown): ValidationResult {
  const errors: string[] = [];
  const migrated = migrate(data);
  if (!isRecord(migrated)) {
    return { ok: false, errors: ['The root value must be an object'] };
  }
  if (migrated.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `Unsupported schemaVersion ${JSON.stringify(migrated.schemaVersion)} (expected ${CURRENT_SCHEMA_VERSION})`,
      ],
    };
  }
  const groups: Group[] = [];
  if (migrated.groups !== undefined) {
    if (!Array.isArray(migrated.groups)) {
      errors.push('groups must be an array');
    } else {
      migrated.groups.forEach((raw, index) => {
        const group = validateGroup(raw, index, errors);
        if (group) groups.push(group);
      });
    }
  }
  const items: Item[] = [];
  if (migrated.items !== undefined) {
    if (!Array.isArray(migrated.items)) {
      errors.push('items must be an array');
    } else {
      migrated.items.forEach((raw, index) => {
        const item = validateItem(raw, index, errors);
        if (item) items.push(item);
      });
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, file: { schemaVersion: CURRENT_SCHEMA_VERSION, groups, items } };
}

/** Parses and validates file text. */
export function parseFile(text: string): ValidationResult {
  const trimmed = text.trim();
  if (trimmed.length === 0) return { ok: true, file: emptyFile() };
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch (error) {
    return { ok: false, errors: [`Invalid JSON: ${(error as Error).message}`] };
  }
  return validateFile(data);
}

function orderedGroup(group: Group): Record<string, unknown> {
  const out: Record<string, unknown> = { id: group.id, name: group.name };
  if (group.parentId !== undefined) out.parentId = group.parentId;
  out.order = group.order;
  return out;
}

function orderedContext(context: ItemContext): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  if (context.languages?.length) out.languages = [...context.languages];
  if (context.globs?.length) out.globs = [...context.globs];
  if (context.markers?.length) out.markers = [...context.markers];
  return Object.keys(out).length > 0 ? out : undefined;
}

function orderedItem(item: Item): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: item.id,
    type: item.type,
    title: item.title,
    body: item.body,
  };
  if (item.description) out.description = item.description;
  if (item.prefix) out.prefix = item.prefix;
  if (item.groupId !== undefined) out.groupId = item.groupId;
  out.tags = [...item.tags];
  const context = item.context ? orderedContext(item.context) : undefined;
  if (context) out.context = context;
  if (item.cwd) out.cwd = item.cwd;
  if (item.confirm) out.confirm = item.confirm;
  if (item.steps?.length) out.steps = [...item.steps];
  if (item.pinned) out.pinned = item.pinned;
  out.createdAt = item.createdAt;
  out.updatedAt = item.updatedAt;
  return out;
}

/**
 * Serializes with a stable key order, two-space indentation and a trailing newline, so that
 * files stay diff-friendly.
 */
export function serializeFile(file: SnipPickFile): string {
  const ordered = {
    schemaVersion: file.schemaVersion,
    groups: file.groups.map(orderedGroup),
    items: file.items.map(orderedItem),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}
