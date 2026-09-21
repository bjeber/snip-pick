import * as vscode from 'vscode';
import { registerCompletions } from './completions';
import { registerAuthCommands } from './commands/authCommands';
import { registerCreateCommands } from './commands/createCommands';
import { registerDiscoveryCommands } from './commands/discoveryCommands';
import { registerGroupCommands } from './commands/groupCommands';
import { registerItemCommands } from './commands/itemCommands';
import { registerSecretCommands } from './commands/secretCommands';
import { registerTransferCommands } from './commands/transferCommands';
import { registerViewCommands, syncRelevantOnlyContext } from './commands/viewCommands';
import type { Services } from './commands/services';
import { SnipPickAuthProvider } from './auth/authProvider';
import { ContextService } from './context/contextService';
import { RemoteService } from './remote/remoteService';
import { DiscoveryService } from './discovery/discoveryService';
import { initLog, log } from './log';
import { ItemRunner } from './runner/runner';
import { TemplateResolver } from './runner/resolve';
import { TerminalRunner } from './runner/terminal';
import { VariableHistory } from './store/history';
import { SecretsStore } from './store/secrets';
import { Store } from './store/store';
import { UsageStore } from './store/usageStore';
import type { TreeNode } from './ui/tree/nodes';
import { LibraryTreeProvider } from './ui/tree/treeProvider';

/** Exposed to integration tests; not a public extension API. */
export interface SnipPickApi {
  store: Store;
  tree: LibraryTreeProvider;
  contextService: ContextService;
  discovery: DiscoveryService;
  remote: RemoteService;
}

export async function activate(context: vscode.ExtensionContext): Promise<SnipPickApi> {
  const channel = initLog();
  context.subscriptions.push(channel);
  log().info('Snip Pick is starting up');

  const store = new Store(context);
  const usage = new UsageStore(context);
  const secrets = new SecretsStore(context);
  const history = new VariableHistory(context);
  const contextService = new ContextService();
  const discovery = new DiscoveryService();
  const terminals = new TerminalRunner();
  const authProvider = new SnipPickAuthProvider(context);
  const remote = new RemoteService(context, authProvider);
  const resolver = new TemplateResolver(secrets, history);
  const runner = new ItemRunner(store, usage, resolver, terminals, contextService);

  context.subscriptions.push(store, contextService, discovery, terminals, authProvider, remote);

  const tree = new LibraryTreeProvider(store, usage, contextService, discovery, remote);
  const treeView = vscode.window.createTreeView<TreeNode>('snipPick.library', {
    treeDataProvider: tree,
    dragAndDropController: tree,
    showCollapseAll: true,
    canSelectMany: true,
  });
  context.subscriptions.push(
    tree,
    treeView,
    vscode.window.registerFileDecorationProvider(tree.decorations),
  );

  const services: Services = {
    context,
    store,
    usage,
    secrets,
    contextService,
    discovery,
    remote,
    runner,
    tree,
    treeView,
  };

  context.subscriptions.push(
    ...registerItemCommands(services),
    ...registerCreateCommands(services),
    ...registerGroupCommands(services),
    ...registerViewCommands(services),
    ...registerTransferCommands(services),
    ...registerSecretCommands(services),
    ...registerDiscoveryCommands(services),
    ...registerAuthCommands(services),
    registerCompletions(store, contextService),
  );

  syncRelevantOnlyContext();

  await store.initialize();
  await contextService.initialize();
  await discovery.refresh();
  // Remote vaults load in the background: a slow or unreachable server must never hold up
  // activation, and the tree renders its local scopes immediately either way.
  void remote.refresh();
  tree.refresh();
  log().info(`Snip Pick ready with ${store.allItems().length} item(s)`);

  return { store, tree, contextService, discovery, remote };
}

export function deactivate(): void {
  // Everything is registered in context.subscriptions and disposed by VS Code.
}
