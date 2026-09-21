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
