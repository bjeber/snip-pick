import type { UsageEntry } from '@snip-pick/contracts';

/** Usage counts lose half their weight every week. */
export const HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

/** Exponential decay factor in `(0, 1]` for something last used at `lastUsed`. */
export function decay(lastUsed: number, now: number, halfLifeMs = HALF_LIFE_MS): number {
  if (!Number.isFinite(lastUsed) || lastUsed >= now) return 1;
  const age = now - lastUsed;
  return Math.pow(0.5, age / halfLifeMs);
}

/** Frequency weighted by recency: often-used items beat long-forgotten ones. */
export function frecency(
  usage: UsageEntry | undefined,
  now: number,
  halfLifeMs = HALF_LIFE_MS,
): number {
  if (!usage || usage.uses <= 0) return 0;
  return usage.uses * decay(usage.lastUsed, now, halfLifeMs);
}
