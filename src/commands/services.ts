import type * as vscode from 'vscode';
import type { ContextService } from '../context/contextService';
import type { DiscoveryService } from '../discovery/discoveryService';
import type { ItemRunner } from '../runner/runner';
import type { SecretsStore } from '../store/secrets';
import type { Store } from '../store/store';
import type { UsageStore } from '../store/usageStore';
import type { LibraryTreeProvider } from '../ui/tree/treeProvider';
import type { TreeNode } from '../ui/tree/nodes';

/** Everything the command handlers need, wired once in `extension.ts`. */
export interface Services {
  context: vscode.ExtensionContext;
  store: Store;
  usage: UsageStore;
  secrets: SecretsStore;
  contextService: ContextService;
  discovery: DiscoveryService;
  runner: ItemRunner;
  tree: LibraryTreeProvider;
  treeView: vscode.TreeView<TreeNode>;
}
