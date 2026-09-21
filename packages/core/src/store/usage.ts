import type { Usage } from '@snip-pick/contracts';

/** Records one use of `itemId`. Returns a new map; the input is not mutated. */
export function recordUse(usage: Usage, itemId: string, now: number = Date.now()): Usage {
  const previous = usage[itemId];
  return {
    ...usage,
    [itemId]: { uses: (previous?.uses ?? 0) + 1, lastUsed: now },
  };
}

/** Drops statistics for items that no longer exist, so the memento does not grow forever. */
export function pruneUsage(usage: Usage, knownIds: Iterable<string>): Usage {
  const known = new Set(knownIds);
  const out: Usage = {};
  for (const [id, entry] of Object.entries(usage)) {
    if (known.has(id)) out[id] = entry;
  }
  return out;
}
