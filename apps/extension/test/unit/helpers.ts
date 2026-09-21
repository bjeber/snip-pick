import type { Item } from '@snip-pick/contracts';

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
