import { describe, expect, it } from 'vitest';
import { mergeFiles } from '../../src/store/merge';
import { makeFile, makeItem } from './helpers';

describe('mergeFiles', () => {
  it('replaces everything when asked to', () => {
    const base = makeFile({ items: [makeItem({ id: 'old' })] });
    const incoming = makeFile({ items: [makeItem({ id: 'new' })] });
    const result = mergeFiles(base, incoming, 'replace');
    expect(result.file.items.map((item) => item.id)).toEqual(['new']);
    expect(result.addedItems).toBe(1);
  });

  it('adds unknown items', () => {
    const base = makeFile({ items: [makeItem({ id: 'a' })] });
    const incoming = makeFile({ items: [makeItem({ id: 'b' })] });
    const result = mergeFiles(base, incoming);
    expect(result.file.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(result).toMatchObject({ addedItems: 1, updatedItems: 0, skippedItems: 0 });
  });

  it('overwrites only when the incoming item is newer', () => {
    const base = makeFile({ items: [makeItem({ id: 'a', title: 'Local', updatedAt: 200 })] });
    const newer = makeFile({ items: [makeItem({ id: 'a', title: 'Newer', updatedAt: 300 })] });
    const older = makeFile({ items: [makeItem({ id: 'a', title: 'Older', updatedAt: 100 })] });

    expect(mergeFiles(base, newer).file.items[0]?.title).toBe('Newer');
    expect(mergeFiles(base, newer).updatedItems).toBe(1);
    expect(mergeFiles(base, older).file.items[0]?.title).toBe('Local');
    expect(mergeFiles(base, older).skippedItems).toBe(1);
  });

  it('merges groups by id and counts new ones', () => {
    const base = makeFile({ groups: [{ id: 'g', name: 'Old', order: 0 }] });
    const incoming = makeFile({
      groups: [
        { id: 'g', name: 'New', order: 3 },
        { id: 'h', name: 'Other', order: 1 },
      ],
    });
    const result = mergeFiles(base, incoming);
    expect(result.addedGroups).toBe(1);
    expect(result.file.groups.find((group) => group.id === 'g')?.name).toBe('New');
  });

  it('repairs references that the merge would otherwise break', () => {
    const base = makeFile();
    const incoming = makeFile({ items: [makeItem({ groupId: 'nowhere' })] });
    expect(mergeFiles(base, incoming).file.items[0]).not.toHaveProperty('groupId');
  });

  it('does not mutate its inputs', () => {
    const base = makeFile({ items: [makeItem({ id: 'a' })] });
    const incoming = makeFile({ items: [makeItem({ id: 'b' })] });
    mergeFiles(base, incoming);
    expect(base.items).toHaveLength(1);
    expect(incoming.items).toHaveLength(1);
  });
});
