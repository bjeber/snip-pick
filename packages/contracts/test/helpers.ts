import type { Item, SnipPickFile } from '../src/types';

let counter = 0;

export function makeItem(overrides: Partial<Item> = {}): Item {
  counter += 1;
  return {
    id: `item-${counter}`,
    type: 'snippet',
    title: `Item ${counter}`,
    body: 'body',
    tags: [],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

export function makeFile(overrides: Partial<SnipPickFile> = {}): SnipPickFile {
  return { schemaVersion: 1, groups: [], items: [], ...overrides };
}
