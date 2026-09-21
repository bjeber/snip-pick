import * as vscode from 'vscode';
import type { DiscoverySource } from '../../discovery/discoveryService';
import type { DiscoveredTask } from '@snip-pick/core';
import type { ItemRef } from '../../store/store';

export interface ScopeNode {
  kind: 'scope';
  scopeId: string;
}

export interface GroupNode {
  kind: 'group';
  scopeId: string;
  groupId: string;
}

export interface ItemNode {
  kind: 'item';
  scopeId: string;
  itemId: string;
}

export interface ErrorNode {
  kind: 'error';
  scopeId: string;
}

export interface DiscoveryRootNode {
  kind: 'discoveryRoot';
  folderUri: string;
}

export interface DiscoveryGroupNode {
  kind: 'discoveryGroup';
  folderUri: string;
  source: DiscoverySource;
}

export interface DiscoveryItemNode {
  kind: 'discoveryItem';
  folderUri: string;
  source: DiscoverySource;
  task: DiscoveredTask;
}

/** A mounted vault with decisions outstanding, shown at the top of its scope. */
export interface VaultConflictsNode {
  kind: 'vaultConflicts';
  scopeId: string;
}

export interface SignInNode {
  kind: 'signIn';
}

/** Signed in, but nothing mounted yet — the step between signing in and seeing a vault. */
export interface SelectVaultsNode {
  kind: 'selectVaults';
}

export type TreeNode =
  | ScopeNode
  | GroupNode
  | ItemNode
  | ErrorNode
  | DiscoveryRootNode
  | DiscoveryGroupNode
  | DiscoveryItemNode
  | VaultConflictsNode
  | SignInNode
  | SelectVaultsNode;

export function nodeId(node: TreeNode): string {
  switch (node.kind) {
    case 'scope':
      return `scope:${node.scopeId}`;
    case 'group':
      return `group:${node.scopeId}:${node.groupId}`;
    case 'item':
      return `item:${node.scopeId}:${node.itemId}`;
    case 'error':
      return `error:${node.scopeId}`;
    case 'discoveryRoot':
      return `discovery:${node.folderUri}`;
    case 'discoveryGroup':
      return `discovery:${node.folderUri}:${node.source}`;
    case 'discoveryItem':
      return `discovery:${node.folderUri}:${node.source}:${node.task.name}`;
    case 'vaultConflicts':
      return `vault-conflicts:${node.scopeId}`;
    case 'signIn':
      return 'remote:sign-in';
    case 'selectVaults':
      return 'remote:select-vaults';
  }
}

/** Resource URI used to attach relevance/pin decorations to an item row. */
export function itemResourceUri(scopeId: string, itemId: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: 'snippick',
    authority: 'item',
    path: `/${encodeURIComponent(scopeId)}/${itemId}`,
  });
}

export function parseItemResourceUri(uri: vscode.Uri): ItemRef | undefined {
  if (uri.scheme !== 'snippick' || uri.authority !== 'item') return undefined;
  const [, scopeId, itemId] = uri.path.split('/');
  if (!scopeId || !itemId) return undefined;
  return { scopeId: decodeURIComponent(scopeId), itemId };
}
