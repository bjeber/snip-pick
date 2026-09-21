import { normalizeFile } from '../model/normalize';
import { emptyFile, type Group, type Item, type SnipPickFile } from '@snip-pick/contracts';

export type MergeStrategy = 'merge' | 'replace';

export interface MergeResult {
  file: SnipPickFile;
  addedItems: number;
  updatedItems: number;
  skippedItems: number;
  addedGroups: number;
}

/**
 * Combines two libraries.
 *
 * - `replace` throws away `base` entirely.
 * - `merge` keys on ids: unknown ids are added, known ids are overwritten only when the incoming
 *   item is newer (`updatedAt`), so importing a stale export never clobbers fresh edits.
 */
export function mergeFiles(
  base: SnipPickFile,
  incoming: SnipPickFile,
  strategy: MergeStrategy = 'merge',
): MergeResult {
  if (strategy === 'replace') {
    return {
      file: normalizeFile({
        ...emptyFile(),
        groups: [...incoming.groups],
        items: [...incoming.items],
      }),
      addedItems: incoming.items.length,
      updatedItems: 0,
      skippedItems: 0,
      addedGroups: incoming.groups.length,
    };
  }

  const groups: Group[] = [...base.groups];
  const groupIndex = new Map(groups.map((group, index) => [group.id, index]));
  let addedGroups = 0;
  for (const group of incoming.groups) {
    const existing = groupIndex.get(group.id);
    if (existing === undefined) {
      groupIndex.set(group.id, groups.length);
      groups.push({ ...group });
      addedGroups += 1;
    } else {
      groups[existing] = { ...group };
    }
  }

  const items: Item[] = [...base.items];
  const itemIndex = new Map(items.map((item, index) => [item.id, index]));
  let addedItems = 0;
  let updatedItems = 0;
  let skippedItems = 0;
  for (const item of incoming.items) {
    const existing = itemIndex.get(item.id);
    if (existing === undefined) {
      itemIndex.set(item.id, items.length);
      items.push({ ...item });
      addedItems += 1;
      continue;
    }
    if (item.updatedAt > items[existing]!.updatedAt) {
      items[existing] = { ...item };
      updatedItems += 1;
    } else {
      skippedItems += 1;
    }
  }

  return {
    file: normalizeFile({ schemaVersion: 1, groups, items }),
    addedItems,
    updatedItems,
    skippedItems,
    addedGroups,
  };
}
