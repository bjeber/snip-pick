import { describe, expect, it } from 'vitest';
import {
  descendantGroupIds,
  groupPath,
  normalizeFile,
  normalizeGroups,
  wouldCreateCycle,
} from '../../src/model/normalize';
import { makeFile, makeItem } from './helpers';

const groups = [
  { id: 'a', name: 'A', order: 0 },
  { id: 'b', name: 'B', order: 0, parentId: 'a' },
  { id: 'c', name: 'C', order: 1, parentId: 'b' },
];

describe('normalizeGroups', () => {
  it('drops duplicate ids', () => {
    const result = normalizeGroups([groups[0]!, { ...groups[0]!, name: 'Other' }]);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('A');
  });

  it('clears unknown parents', () => {
    const result = normalizeGroups([{ id: 'x', name: 'X', order: 0, parentId: 'missing' }]);
    expect(result[0]).not.toHaveProperty('parentId');
  });

  it('clears self-parenting and cycles', () => {
    const cyclic = [
      { id: 'a', name: 'A', order: 0, parentId: 'b' },
      { id: 'b', name: 'B', order: 0, parentId: 'a' },
      { id: 'self', name: 'S', order: 0, parentId: 'self' },
    ];
    const result = normalizeGroups(cyclic);
    expect(result.every((group) => group.parentId === undefined)).toBe(true);
  });
});

describe('normalizeFile', () => {
  it('unsets item groupIds that point nowhere', () => {
    const file = normalizeFile(
      makeFile({ groups: [groups[0]!], items: [makeItem({ groupId: 'ghost' })] }),
    );
    expect(file.items[0]).not.toHaveProperty('groupId');
  });

  it('keeps valid references', () => {
    const file = normalizeFile(
      makeFile({ groups: [groups[0]!], items: [makeItem({ groupId: 'a' })] }),
    );
    expect(file.items[0]?.groupId).toBe('a');
  });
});

describe('wouldCreateCycle', () => {
  it('detects direct and indirect cycles', () => {
    expect(wouldCreateCycle(groups, 'a', 'a')).toBe(true);
    expect(wouldCreateCycle(groups, 'a', 'c')).toBe(true);
    expect(wouldCreateCycle(groups, 'c', 'a')).toBe(false);
    expect(wouldCreateCycle(groups, 'c', undefined)).toBe(false);
  });
});

describe('descendantGroupIds', () => {
  it('walks the whole subtree', () => {
    expect(descendantGroupIds(groups, 'a')).toEqual(['b', 'c']);
    expect(descendantGroupIds(groups, 'c')).toEqual([]);
  });
});

describe('groupPath', () => {
  it('joins ancestors with slashes', () => {
    expect(groupPath(groups, 'c')).toBe('A / B / C');
    expect(groupPath(groups, undefined)).toBe('');
  });
});
