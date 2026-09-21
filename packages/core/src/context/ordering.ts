import type { Item, Usage } from '@snip-pick/contracts';
import { frecency } from './frecency';
import { scoreRelevance, type Relevance, type RelevanceContext } from './relevance';

export interface RankedItem<T extends Item = Item> {
  item: T;
  relevance: Relevance;
  frecency: number;
}

export interface RankOptions {
  active: RelevanceContext;
  /** Usage lookup by item id. */
  usage?: Usage;
  now?: number;
  /** Drop items whose context rules did not match. */
  relevantOnly?: boolean;
}

function compare(a: RankedItem, b: RankedItem): number {
  const pinnedA = a.item.pinned ? 1 : 0;
  const pinnedB = b.item.pinned ? 1 : 0;
  if (pinnedA !== pinnedB) return pinnedB - pinnedA;

  const relevantA = a.relevance.relevant ? 1 : 0;
  const relevantB = b.relevance.relevant ? 1 : 0;
  if (relevantA !== relevantB) return relevantB - relevantA;

  if (a.relevance.score !== b.relevance.score) return b.relevance.score - a.relevance.score;
  if (a.frecency !== b.frecency) return b.frecency - a.frecency;
  return a.item.title.localeCompare(b.item.title);
}

/**
 * Ranks items: pinned first, then relevance score, then frecency, then title.
 * Items that declare context rules but match none of them sink to the bottom, or are dropped
 * entirely when `relevantOnly` is set.
 */
export function rankItems<T extends Item>(
  items: readonly T[],
  options: RankOptions,
): RankedItem<T>[] {
  const now = options.now ?? Date.now();
  const ranked = items.map((item) => ({
    item,
    relevance: scoreRelevance(item.context, options.active),
    frecency: frecency(options.usage?.[item.id], now),
  }));
  const filtered = options.relevantOnly
    ? ranked.filter((entry) => entry.relevance.relevant)
    : ranked;
  return filtered.sort(compare);
}
