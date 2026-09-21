import { describe, expect, it } from 'vitest';
import { SCORE_GLOB, SCORE_LANGUAGE, SCORE_MARKER, scoreRelevance } from '../src/context/relevance';

const active = {
  languageId: 'typescript',
  relativePath: 'src/lib/thing.test.ts',
  markers: ['package.json', 'README.md'],
};

describe('scoreRelevance', () => {
  it('is neutral and always relevant without context rules', () => {
    expect(scoreRelevance(undefined, active)).toEqual({
      score: 0,
      relevant: true,
      hasContext: false,
    });
    expect(scoreRelevance({}, active)).toEqual({ score: 0, relevant: true, hasContext: false });
    expect(scoreRelevance({ languages: [] }, active)).toMatchObject({ hasContext: false });
  });

  it('scores a language match', () => {
    expect(scoreRelevance({ languages: ['typescript'] }, active)).toEqual({
      score: SCORE_LANGUAGE,
      relevant: true,
      hasContext: true,
    });
  });

  it('scores a glob match against the workspace-relative path', () => {
    expect(scoreRelevance({ globs: ['**/*.test.ts'] }, active).score).toBe(SCORE_GLOB);
    expect(scoreRelevance({ globs: ['**/*.spec.ts'] }, active).relevant).toBe(false);
  });

  it('matches dotfiles', () => {
    expect(
      scoreRelevance({ globs: ['**/.github/**'] }, { relativePath: '.github/workflows/ci.yml' })
        .score,
    ).toBe(SCORE_GLOB);
  });

  it('scores a marker match', () => {
    expect(scoreRelevance({ markers: ['package.json'] }, active).score).toBe(SCORE_MARKER);
    expect(scoreRelevance({ markers: ['Cargo.toml'] }, active).relevant).toBe(false);
  });

  it('stacks bonuses', () => {
    expect(
      scoreRelevance(
        { languages: ['typescript'], globs: ['**/*.test.ts'], markers: ['package.json'] },
        active,
      ).score,
    ).toBe(SCORE_LANGUAGE + SCORE_GLOB + SCORE_MARKER);
  });

  it('marks an item irrelevant when rules exist but none match', () => {
    expect(scoreRelevance({ languages: ['python'] }, active)).toEqual({
      score: 0,
      relevant: false,
      hasContext: true,
    });
  });

  it('copes with an empty editor context', () => {
    expect(scoreRelevance({ languages: ['typescript'] }, {}).relevant).toBe(false);
  });
});
