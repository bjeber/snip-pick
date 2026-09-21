import { minimatch } from 'minimatch';
import type { ItemContext } from '../model/types';

/** Everything the relevance calculation needs to know about the active editor. */
export interface RelevanceContext {
  /** `languageId` of the active document. */
  languageId?: string;
  /** Path of the active file, relative to its workspace folder, using forward slashes. */
  relativePath?: string;
  /** Marker files present at the root of the active workspace folder. */
  markers?: readonly string[];
}

export interface Relevance {
  /** Higher is better. `0` means "no opinion". */
  score: number;
  /** `false` only when the item declares a context and none of its rules matched. */
  relevant: boolean;
  /** Whether the item declares any context rules at all. */
  hasContext: boolean;
}

export const SCORE_LANGUAGE = 3;
export const SCORE_GLOB = 4;
export const SCORE_MARKER = 2;

const NEUTRAL: Relevance = { score: 0, relevant: true, hasContext: false };

function nonEmpty(value: readonly string[] | undefined): value is readonly string[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Scores how well an item's context rules match the active editor.
 *
 * - An item without context rules is always shown, with a neutral score of `0`.
 * - A language match adds {@link SCORE_LANGUAGE}, a glob match {@link SCORE_GLOB} and a marker
 *   match {@link SCORE_MARKER}; the bonuses stack.
 * - An item that declares rules but matches none of them is "not relevant".
 */
export function scoreRelevance(
  context: ItemContext | undefined,
  active: RelevanceContext,
): Relevance {
  const hasLanguages = nonEmpty(context?.languages);
  const hasGlobs = nonEmpty(context?.globs);
  const hasMarkers = nonEmpty(context?.markers);
  if (!context || (!hasLanguages && !hasGlobs && !hasMarkers)) {
    return NEUTRAL;
  }

  let score = 0;
  if (hasLanguages && active.languageId && context.languages!.includes(active.languageId)) {
    score += SCORE_LANGUAGE;
  }
  if (hasGlobs && active.relativePath !== undefined) {
    const path = active.relativePath;
    if (context.globs!.some((glob) => minimatch(path, glob, { dot: true }))) {
      score += SCORE_GLOB;
    }
  }
  if (hasMarkers && active.markers) {
    const markers = active.markers;
    if (context.markers!.some((marker) => markers.includes(marker))) {
      score += SCORE_MARKER;
    }
  }
  return { score, relevant: score > 0, hasContext: true };
}
