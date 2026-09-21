import { emptyFile, type Group, type Item, type SnipPickFile } from '@snip-pick/contracts';
import type { VaultConflict, VaultDelta, VaultPush } from '@snip-pick/contracts';
import { normalizeFile } from '../model/normalize';

/** A vault's contents exactly as the server had them at `revision`. */
export interface SyncSnapshot {
  revision: number;
  file: SnipPickFile;
}

export interface ReconcileResult {
  /**
   * What the working copy should become: remote changes that applied cleanly, local changes kept.
   * A conflicted entity is left exactly as it is locally — the person's own edit does not vanish
   * from under them while they decide what to do about it.
   */
  merged: SnipPickFile;
  /**
   * The server's state at `remote.revision`, to be stored as the new base.
   *
   * It includes the losing side of every conflict, which is what lets a resolution settle: once
   * the base records what the server has, "keep mine" is an ordinary local change to push and
   * "keep theirs" is no change at all. Neither re-raises the conflict on the next pass.
   */
  nextBase: SyncSnapshot;
  /** Local changes the server has not seen. Empty while `conflicts` is not. */
  push: VaultPush;
  /** Changed on both sides since `base.revision`, and not to the same value. */
  conflicts: VaultConflict[];
}

/**
 * Content equality, ignoring `updatedAt`.
 *
 * Two machines never stamp the same edit alike, so comparing the timestamp would report every
 * coincidentally identical edit as a conflict and ask the person to choose between two things
 * that are the same.
 */
function sameContent(a: object | undefined, b: object | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonical(a) === canonical(b);
}

function canonical(entity: object): string {
  const entries = Object.entries(entity)
    .filter(([key, value]) => key !== 'updatedAt' && value !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function byId<T extends { id: string }>(entities: readonly T[]): Map<string, T> {
  return new Map(entities.map((entity) => [entity.id, entity]));
}

/** What the server says happened to one entity since the base revision. */
type RemoteChange<T> = { kind: 'none' } | { kind: 'set'; value: T } | { kind: 'deleted' };

function remoteChanges<T extends { id: string }>(
  changed: readonly T[],
  deleted: readonly string[],
): Map<string, RemoteChange<T>> {
  const map = new Map<string, RemoteChange<T>>();
  for (const entity of changed) map.set(entity.id, { kind: 'set', value: entity });
  for (const id of deleted) map.set(id, { kind: 'deleted' });
  return map;
}

interface Resolved<T> {
  merged: T | undefined;
  base: T | undefined;
  pushed: T | undefined;
  pushedDeletion: boolean;
  conflict: { mine: T | null; theirs: T | null } | undefined;
}

/**
 * The rule, for one entity, in one place.
 *
 * Three inputs: what the server last gave us (`base`), what we have now (`local`), and what the
 * server did since. Changed on one side only, that side wins and nothing is lost. Changed on
 * both to the same content, there is nothing to decide. Changed on both to different content —
 * including one side deleting what the other edited — nobody but the person can say which was
 * meant, so it is reported rather than guessed at.
 */
function resolveOne<T extends { id: string }>(
  base: T | undefined,
  local: T | undefined,
  remote: RemoteChange<T>,
): Resolved<T> {
  const localChanged = !sameContent(base, local);
  const theirs = remote.kind === 'set' ? remote.value : undefined;
  const nextBase = remote.kind === 'none' ? base : theirs;

  if (remote.kind === 'none') {
    return {
      merged: local,
      base,
      pushed: localChanged ? local : undefined,
      pushedDeletion: localChanged && local === undefined && base !== undefined,
      conflict: undefined,
    };
  }
  if (!localChanged) {
    // Only they moved. Take it, including a deletion.
    return {
      merged: theirs,
      base: nextBase,
      pushed: undefined,
      pushedDeletion: false,
      conflict: undefined,
    };
  }
  if (sameContent(local, theirs)) {
    // Both arrived at the same place, or both deleted it. Nothing to decide.
    return {
      merged: theirs,
      base: nextBase,
      pushed: undefined,
      pushedDeletion: false,
      conflict: undefined,
    };
  }
  return {
    merged: local,
    base: nextBase,
    pushed: undefined,
    pushedDeletion: false,
    conflict: { mine: local ?? null, theirs: theirs ?? null },
  };
}

/**
 * Three-way merge between the last synced snapshot, the working copy and the server's delta.
 *
 * Pure: no clock, no network, no editor. The ordering that matters comes from the vault's
 * revision counter, which the server owns, so nothing here depends on two machines agreeing
 * about the time.
 */
export function reconcile(
  base: SyncSnapshot,
  local: SnipPickFile,
  remote: VaultDelta,
): ReconcileResult {
  const baseItems = byId(base.file.items);
  const baseGroups = byId(base.file.groups);
  const localItems = byId(local.items);
  const localGroups = byId(local.groups);
  const remoteItems = remoteChanges(remote.items, remote.deletedItems);
  const remoteGroups = remoteChanges(remote.groups, remote.deletedGroups);

  const mergedItems: Item[] = [];
  const nextBaseItems: Item[] = [];
  const pushItems: Item[] = [];
  const deletedItems: string[] = [];
  const mergedGroups: Group[] = [];
  const nextBaseGroups: Group[] = [];
  const pushGroups: Group[] = [];
  const deletedGroups: string[] = [];
  const conflicts: VaultConflict[] = [];

  for (const id of union(baseItems, localItems, remoteItems)) {
    const outcome = resolveOne(baseItems.get(id), localItems.get(id), remoteItems.get(id) ?? none);
    if (outcome.merged) mergedItems.push(outcome.merged);
    if (outcome.base) nextBaseItems.push(outcome.base);
    if (outcome.pushed) pushItems.push(outcome.pushed);
    if (outcome.pushedDeletion) deletedItems.push(id);
    if (outcome.conflict) conflicts.push({ kind: 'item', id, ...outcome.conflict });
  }
  for (const id of union(baseGroups, localGroups, remoteGroups)) {
    const outcome = resolveOne(
      baseGroups.get(id),
      localGroups.get(id),
      remoteGroups.get(id) ?? none,
    );
    if (outcome.merged) mergedGroups.push(outcome.merged);
    if (outcome.base) nextBaseGroups.push(outcome.base);
    if (outcome.pushed) pushGroups.push(outcome.pushed);
    if (outcome.pushedDeletion) deletedGroups.push(id);
    if (outcome.conflict) conflicts.push({ kind: 'group', id, ...outcome.conflict });
  }

  // Blocked rather than partial: pushing half of a vault while the person still owes a decision
  // about the other half moves the revision on and makes the conflict harder to reason about.
  const blocked = conflicts.length > 0;

  return {
    merged: normalizeFile({ ...emptyFile(), groups: mergedGroups, items: mergedItems }),
    nextBase: {
      revision: remote.revision,
      file: normalizeFile({ ...emptyFile(), groups: nextBaseGroups, items: nextBaseItems }),
    },
    push: {
      baseRevision: remote.revision,
      items: blocked ? [] : pushItems,
      groups: blocked ? [] : pushGroups,
      deletedItems: blocked ? [] : deletedItems,
      deletedGroups: blocked ? [] : deletedGroups,
    },
    conflicts,
  };
}

const none: RemoteChange<never> = { kind: 'none' };

function union(...maps: ReadonlyArray<ReadonlyMap<string, unknown>>): string[] {
  const ids = new Set<string>();
  for (const map of maps) for (const id of map.keys()) ids.add(id);
  return [...ids];
}

/** Whether a push would say anything. */
export function isEmptyPush(push: VaultPush): boolean {
  return (
    push.items.length === 0 &&
    push.groups.length === 0 &&
    push.deletedItems.length === 0 &&
    push.deletedGroups.length === 0
  );
}
