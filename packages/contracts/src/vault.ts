import type { Group, Item } from './types';

/**
 * Wire types shared by the API and its clients.
 *
 * Keeping them here rather than in either side means there is one definition of what a vault
 * looks like, and a change to it breaks compilation on both ends at once.
 */

export type VaultKind = 'personal' | 'project';

export interface OrganizationRef {
  id: string;
  name: string;
  slug: string;
}

export interface VaultSummary {
  id: string;
  name: string;
  kind: VaultKind;
  /** Per-vault counter bumped on every write; clients pull deltas with `?since=`. */
  revision: number;
  organization: OrganizationRef;
  teamId?: string;
}

export interface VaultListResponse {
  vaults: VaultSummary[];
}

/**
 * What changed in a vault, as of `revision`.
 *
 * Deletions travel as ids rather than as absent entries: "not in this list" and "deleted" are
 * different facts, and a client that could not tell them apart would resurrect on its next push
 * everything the other side had just removed.
 */
export interface VaultDelta {
  /** The revision the recipient is up to date with once this is applied. */
  revision: number;
  items: Item[];
  groups: Group[];
  deletedItems: string[];
  deletedGroups: string[];
}

/**
 * Local changes offered to the server.
 *
 * `baseRevision` is the revision the client last held in full, and it is what makes conflict
 * detection exact: the server compares it against the revision each row was last written at, so
 * "we both changed this" is a fact about the data rather than a guess from timestamps. Item
 * `updatedAt` comes from whichever machine made the edit and two of those cannot be ordered
 * against each other at all.
 */
export interface VaultPush {
  baseRevision: number;
  items: Item[];
  groups: Group[];
  deletedItems: string[];
  deletedGroups: string[];
}

/**
 * One entity that both sides changed since `baseRevision`.
 *
 * `null` on either side means that side deleted it — an edit/delete pair is as much a conflict as
 * two edits, and the person is the only one who knows which they meant.
 */
export type VaultConflict =
  | { kind: 'item'; id: string; mine: Item | null; theirs: Item | null }
  | { kind: 'group'; id: string; mine: Group | null; theirs: Group | null };

export interface VaultPushResult {
  /** The vault revision after everything non-conflicting was applied. */
  revision: number;
  applied: number;
  /** Rejected, and still to be resolved. Nothing here was written. */
  conflicts: VaultConflict[];
}

export interface MeResponse {
  userId: string;
  scopes: string[];
  clientId?: string;
}

/** Stable identity for a mounted vault, unique across servers. */
export function vaultKey(serverUrl: string, vaultId: string): string {
  return `${serverUrl.replace(/\/+$/, '')}#${vaultId}`;
}

/** How a vault is labelled in the tree and the Quick Pick. */
export function vaultLabel(vault: VaultSummary): string {
  return `${vault.organization.name} · ${vault.name}`;
}
