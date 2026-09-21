import type { Group, Item, SnipPickFile } from './types';

/**
 * Repairs references that would otherwise break the tree: unknown `groupId`/`parentId` values and
 * cycles in the group hierarchy. Returns a new file; the input is not mutated.
 */
export function normalizeFile(file: SnipPickFile): SnipPickFile {
  const groups = normalizeGroups(file.groups);
  const groupIds = new Set(groups.map((group) => group.id));
  const items = file.items.map((item) =>
    item.groupId !== undefined && !groupIds.has(item.groupId) ? stripGroup(item) : item,
  );
  return { schemaVersion: file.schemaVersion, groups, items };
}

function stripGroup(item: Item): Item {
  const { groupId: _groupId, ...rest } = item;
  return rest;
}

function stripParent(group: Group): Group {
  const { parentId: _parentId, ...rest } = group;
  return rest;
}

/** Drops duplicate ids, unknown parents and parent cycles. */
export function normalizeGroups(groups: readonly Group[]): Group[] {
  const seen = new Set<string>();
  const unique: Group[] = [];
  for (const group of groups) {
    if (seen.has(group.id)) continue;
    seen.add(group.id);
    unique.push(group);
  }
  const byId = new Map(unique.map((group) => [group.id, group]));
  return unique.map((group) => {
    if (group.parentId === undefined) return group;
    if (!byId.has(group.parentId) || group.parentId === group.id) return stripParent(group);
    return hasCycle(group, byId) ? stripParent(group) : group;
  });
}

function hasCycle(group: Group, byId: ReadonlyMap<string, Group>): boolean {
  const visited = new Set<string>([group.id]);
  let current = group.parentId === undefined ? undefined : byId.get(group.parentId);
  while (current) {
    if (visited.has(current.id)) return true;
    visited.add(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return false;
}

/** `true` when making `groupId` a child of `parentId` would create a cycle. */
export function wouldCreateCycle(
  groups: readonly Group[],
  groupId: string,
  parentId: string | undefined,
): boolean {
  if (parentId === undefined) return false;
  if (parentId === groupId) return true;
  const byId = new Map(groups.map((group) => [group.id, group]));
  let current = byId.get(parentId);
  const visited = new Set<string>();
  while (current) {
    if (current.id === groupId) return true;
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return false;
}

/** All descendants of `groupId`, excluding the group itself. */
export function descendantGroupIds(groups: readonly Group[], groupId: string): string[] {
  const children = new Map<string, string[]>();
  for (const group of groups) {
    if (group.parentId === undefined) continue;
    const bucket = children.get(group.parentId);
    if (bucket) bucket.push(group.id);
    else children.set(group.parentId, [group.id]);
  }
  const out: string[] = [];
  const queue = [...(children.get(groupId) ?? [])];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Full `Parent / Child` path of a group, for labels and Quick Pick descriptions. */
export function groupPath(groups: readonly Group[], groupId: string | undefined): string {
  if (groupId === undefined) return '';
  const byId = new Map(groups.map((group) => [group.id, group]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(groupId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return parts.join(' / ');
}
