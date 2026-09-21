import { describe, expect, it } from 'vitest';
import { HALF_LIFE_MS } from '../../src/context/frecency';
import { rankItems } from '../../src/context/ordering';
import { makeItem } from './helpers';

const now = 10 * HALF_LIFE_MS;
const active = { languageId: 'typescript', relativePath: 'a.ts', markers: ['package.json'] };

describe('rankItems', () => {
  it('puts pinned items first, even when irrelevant', () => {
    const pinned = makeItem({ title: 'Pinned', pinned: true, context: { languages: ['python'] } });
    const relevant = makeItem({ title: 'Relevant', context: { languages: ['typescript'] } });
    const ranked = rankItems([relevant, pinned], { active, now });
    expect(ranked.map((entry) => entry.item.title)).toEqual(['Pinned', 'Relevant']);
  });

  it('orders by relevance score, then frecency, then title', () => {
    const glob = makeItem({ title: 'Glob', context: { globs: ['**/*.ts'] } });
    const language = makeItem({ title: 'Language', context: { languages: ['typescript'] } });
    const neutralA = makeItem({ title: 'Alpha' });
    const neutralB = makeItem({ title: 'Beta' });
    const ranked = rankItems([neutralB, neutralA, language, glob], { active, now });
    expect(ranked.map((entry) => entry.item.title)).toEqual(['Glob', 'Language', 'Alpha', 'Beta']);
  });

  it('breaks relevance ties with frecency', () => {
    const rare = makeItem({ title: 'Rare' });
    const common = makeItem({ title: 'Xommon' });
    const ranked = rankItems([rare, common], {
      active,
      now,
      usage: { [common.id]: { uses: 5, lastUsed: now } },
    });
    expect(ranked[0]?.item.title).toBe('Xommon');
  });

  it('sinks non-matching items to the bottom', () => {
    const miss = makeItem({ title: 'Aaa', context: { languages: ['python'] } });
    const neutral = makeItem({ title: 'Zzz' });
    const ranked = rankItems([miss, neutral], { active, now });
    expect(ranked.map((entry) => entry.item.title)).toEqual(['Zzz', 'Aaa']);
  });

  it('drops non-matching items when relevantOnly is set', () => {
    const miss = makeItem({ title: 'Miss', context: { languages: ['python'] } });
    const neutral = makeItem({ title: 'Neutral' });
    const ranked = rankItems([miss, neutral], { active, now, relevantOnly: true });
    expect(ranked.map((entry) => entry.item.title)).toEqual(['Neutral']);
  });

  it('does not mutate the input array', () => {
    const items = [makeItem({ title: 'B' }), makeItem({ title: 'A' })];
    rankItems(items, { active, now });
    expect(items.map((item) => item.title)).toEqual(['B', 'A']);
  });
});
