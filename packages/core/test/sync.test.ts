import { describe, expect, it } from 'vitest';
import { emptyFile, type Group, type Item, type SnipPickFile } from '@snip-pick/contracts';
import type { VaultDelta } from '@snip-pick/contracts';
import { isEmptyPush, reconcile, type SyncSnapshot } from '../src/store/sync';

function item(id: string, overrides: Partial<Item> = {}): Item {
  return {
    id,
    type: 'command',
    title: id,
    body: `echo ${id}`,
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function group(id: string, overrides: Partial<Group> = {}): Group {
  return { id, name: id, order: 0, ...overrides };
}

function file(items: Item[] = [], groups: Group[] = []): SnipPickFile {
  return { ...emptyFile(), items, groups };
}

function snapshot(revision: number, contents: SnipPickFile): SyncSnapshot {
  return { revision, file: contents };
}

function delta(revision: number, overrides: Partial<VaultDelta> = {}): VaultDelta {
  return { revision, items: [], groups: [], deletedItems: [], deletedGroups: [], ...overrides };
}

const titles = (contents: SnipPickFile): string[] =>
  contents.items.map((entry) => entry.title).sort();

describe('reconcile', () => {
  it('does nothing when neither side moved', () => {
    const base = snapshot(4, file([item('a')]));
    const result = reconcile(base, file([item('a')]), delta(4));

    expect(result.conflicts).toEqual([]);
    expect(isEmptyPush(result.push)).toBe(true);
    expect(titles(result.merged)).toEqual(['a']);
    expect(result.nextBase.revision).toBe(4);
  });

  it('takes a remote change the working copy has not touched', () => {
    const base = snapshot(4, file([item('a')]));
    const theirs = item('a', { title: 'renamed by them', updatedAt: 9 });
    const result = reconcile(base, file([item('a')]), delta(5, { items: [theirs] }));

    expect(result.conflicts).toEqual([]);
    expect(titles(result.merged)).toEqual(['renamed by them']);
    expect(isEmptyPush(result.push)).toBe(true);
    expect(result.nextBase.revision).toBe(5);
  });

  it('pushes a local change the server has not seen', () => {
    const base = snapshot(4, file([item('a')]));
    const mine = item('a', { title: 'renamed by me', updatedAt: 9 });
    const result = reconcile(base, file([mine]), delta(4));

    expect(result.conflicts).toEqual([]);
    expect(result.push.items).toEqual([mine]);
    expect(result.push.baseRevision).toBe(4);
    expect(titles(result.merged)).toEqual(['renamed by me']);
  });

  it('applies both sides when they changed different entities', () => {
    const base = snapshot(4, file([item('a'), item('b')]));
    const mine = item('a', { title: 'mine' });
    const theirs = item('b', { title: 'theirs' });
    const result = reconcile(base, file([mine, item('b')]), delta(5, { items: [theirs] }));

    expect(result.conflicts).toEqual([]);
    expect(titles(result.merged)).toEqual(['mine', 'theirs']);
    expect(result.push.items).toEqual([mine]);
  });

  it('reports an edit both sides made differently, and pushes nothing', () => {
    const base = snapshot(4, file([item('a')]));
    const mine = item('a', { title: 'mine', updatedAt: 10 });
    const theirs = item('a', { title: 'theirs', updatedAt: 11 });
    const result = reconcile(base, file([mine]), delta(5, { items: [theirs] }));

    expect(result.conflicts).toEqual([{ kind: 'item', id: 'a', mine, theirs }]);
    // Blocked: a half-applied push moves the revision on while a decision is still owed.
    expect(isEmptyPush(result.push)).toBe(true);
    // The person's own edit stays on screen while they decide.
    expect(titles(result.merged)).toEqual(['mine']);
  });

  it('treats an edit against a delete as a conflict, in both directions', () => {
    const base = snapshot(4, file([item('a')]));
    const mine = item('a', { title: 'mine', updatedAt: 10 });

    const theyDeleted = reconcile(base, file([mine]), delta(5, { deletedItems: ['a'] }));
    expect(theyDeleted.conflicts).toEqual([{ kind: 'item', id: 'a', mine, theirs: null }]);

    const theirs = item('a', { title: 'theirs', updatedAt: 11 });
    const iDeleted = reconcile(base, file([]), delta(5, { items: [theirs] }));
    expect(iDeleted.conflicts).toEqual([{ kind: 'item', id: 'a', mine: null, theirs }]);
  });

  it('does not ask about an edit both sides made identically', () => {
    const base = snapshot(4, file([item('a')]));
    // Same content, different clocks — which is what two machines always produce.
    const mine = item('a', { title: 'same', updatedAt: 10 });
    const theirs = item('a', { title: 'same', updatedAt: 987 });
    const result = reconcile(base, file([mine]), delta(5, { items: [theirs] }));

    expect(result.conflicts).toEqual([]);
    expect(titles(result.merged)).toEqual(['same']);
    expect(isEmptyPush(result.push)).toBe(true);
  });

  it('does not ask when both sides deleted the same item', () => {
    const base = snapshot(4, file([item('a')]));
    const result = reconcile(base, file([]), delta(5, { deletedItems: ['a'] }));

    expect(result.conflicts).toEqual([]);
    expect(result.merged.items).toEqual([]);
    expect(isEmptyPush(result.push)).toBe(true);
  });

  it('pushes a local delete the server has not seen', () => {
    const base = snapshot(4, file([item('a'), item('b')]));
    const result = reconcile(base, file([item('b')]), delta(4));

    expect(result.push.deletedItems).toEqual(['a']);
    expect(titles(result.merged)).toEqual(['b']);
  });

  it('takes a remote delete the working copy has not touched', () => {
    const base = snapshot(4, file([item('a'), item('b')]));
    const result = reconcile(base, file([item('a'), item('b')]), delta(5, { deletedItems: ['a'] }));

    expect(result.conflicts).toEqual([]);
    expect(titles(result.merged)).toEqual(['b']);
    expect(result.nextBase.file.items.map((entry) => entry.id)).toEqual(['b']);
  });

  it('carries the losing side into the next base, so a resolution settles', () => {
    const base = snapshot(4, file([item('a')]));
    const mine = item('a', { title: 'mine', updatedAt: 10 });
    const theirs = item('a', { title: 'theirs', updatedAt: 11 });
    const first = reconcile(base, file([mine]), delta(5, { items: [theirs] }));
    expect(first.conflicts).toHaveLength(1);

    // "Keep mine": the working copy is untouched, and the base now records what the server has.
    const second = reconcile(first.nextBase, file([mine]), delta(5));
    expect(second.conflicts).toEqual([]);
    expect(second.push.items).toEqual([mine]);

    // "Keep theirs": the working copy takes their version, and there is nothing left to say.
    const third = reconcile(first.nextBase, file([theirs]), delta(5));
    expect(third.conflicts).toEqual([]);
    expect(isEmptyPush(third.push)).toBe(true);
  });

  it('merges groups by the same rule', () => {
    const base = snapshot(4, file([], [group('g')]));
    const mine = group('g', { name: 'mine', updatedAt: 10 });
    const theirs = group('g', { name: 'theirs', updatedAt: 11 });

    const clean = reconcile(base, file([], [group('g')]), delta(5, { groups: [theirs] }));
    expect(clean.conflicts).toEqual([]);
    expect(clean.merged.groups[0]?.name).toBe('theirs');

    const clash = reconcile(base, file([], [mine]), delta(5, { groups: [theirs] }));
    expect(clash.conflicts).toEqual([{ kind: 'group', id: 'g', mine, theirs }]);
  });

  it('repairs references, so a remote delete cannot leave an item pointing at nothing', () => {
    const base = snapshot(4, file([item('a', { groupId: 'g' })], [group('g')]));
    const result = reconcile(
      base,
      file([item('a', { groupId: 'g' })], [group('g')]),
      delta(5, { deletedGroups: ['g'] }),
    );

    expect(result.merged.groups).toEqual([]);
    expect(result.merged.items[0]?.groupId).toBeUndefined();
  });

  it('adds what only one side created', () => {
    const base = snapshot(4, file());
    const mine = item('mine');
    const theirs = item('theirs');
    const result = reconcile(base, file([mine]), delta(5, { items: [theirs] }));

    expect(result.conflicts).toEqual([]);
    expect(titles(result.merged)).toEqual(['mine', 'theirs']);
    expect(result.push.items).toEqual([mine]);
  });
});
