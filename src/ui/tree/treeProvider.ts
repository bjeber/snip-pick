import * as vscode from 'vscode';
import type { ContextService } from '../../context/contextService';
import { rankItems } from '../../context/ordering';
import { scoreRelevance } from '../../context/relevance';
import type { DiscoveryService } from '../../discovery/discoveryService';
import { bodyPreview, commandText, type Group, type Item } from '../../model/types';
import type { ItemRef, ScopeInfo, Store } from '../../store/store';
import type { UsageStore } from '../../store/usageStore';
import { ItemDecorationProvider, type ItemDecorationState } from './decorations';
import { itemResourceUri, nodeId, type TreeNode } from './nodes';

export const DND_MIME = 'application/vnd.code.tree.snippick.library';

function sortGroups(groups: Group[]): Group[] {
  return [...groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

/** The `snipPick.library` view: scopes → groups → items, plus a read-only "Discovered" node. */
export class LibraryTreeProvider
  implements
    vscode.TreeDataProvider<TreeNode>,
    vscode.TreeDragAndDropController<TreeNode>,
    vscode.Disposable
{
  readonly dropMimeTypes = [DND_MIME];
  readonly dragMimeTypes = [DND_MIME];

  private readonly emitter = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  readonly decorations: ItemDecorationProvider;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly store: Store,
    private readonly usage: UsageStore,
    private readonly contextService: ContextService,
    private readonly discovery: DiscoveryService,
  ) {
    this.decorations = new ItemDecorationProvider((ref) => this.decorationFor(ref));
    this.disposables.push(
      this.emitter,
      this.decorations,
      this.store.onDidChange(() => this.refresh()),
      this.contextService.onDidChange(() => this.refresh()),
      this.discovery.onDidChange(() => this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('snipPick')) this.refresh();
      }),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  refresh(): void {
    this.emitter.fire(undefined);
    this.decorations.refresh();
  }

  private get relevantOnly(): boolean {
    return vscode.workspace.getConfiguration('snipPick').get<boolean>('showRelevantOnly', false);
  }

  private decorationFor(ref: ItemRef): ItemDecorationState | undefined {
    const item = this.store.getItem(ref);
    if (!item) return undefined;
    const relevance = scoreRelevance(item.context, this.contextService.context());
    return { pinned: item.pinned === true, dimmed: !relevance.relevant };
  }

  // -------------------------------------------------------------- children

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) return this.rootNodes();
    switch (element.kind) {
      case 'scope':
        return this.scopeChildren(element.scopeId);
      case 'group':
        return this.groupChildren(element.scopeId, element.groupId);
      case 'discoveryRoot':
        return this.discoveryGroups(element.folderUri);
      case 'discoveryGroup':
        return this.discoveryItems(element.folderUri, element.source);
      default:
        return [];
    }
  }

  private rootNodes(): TreeNode[] {
    return this.store.scopes().map((scope) => ({ kind: 'scope', scopeId: scope.id }) as TreeNode);
  }

  private scopeChildren(scopeId: string): TreeNode[] {
    const nodes: TreeNode[] = [];
    if (this.store.errorFor(scopeId)) nodes.push({ kind: 'error', scopeId });
    const groups = sortGroups(this.store.groups(scopeId).filter((g) => g.parentId === undefined));
    nodes.push(
      ...groups.map((group) => ({ kind: 'group', scopeId, groupId: group.id }) as TreeNode),
    );
    nodes.push(...this.itemNodes(scopeId, undefined));

    const scope = this.store.scope(scopeId);
    if (
      scope?.folder &&
      this.discovery.enabled &&
      this.discovery.groupsFor(scope.folder).length > 0
    ) {
      nodes.push({ kind: 'discoveryRoot', folderUri: scope.folder.uri.toString() });
    }
    return nodes;
  }

  private groupChildren(scopeId: string, groupId: string): TreeNode[] {
    const groups = sortGroups(this.store.groups(scopeId).filter((g) => g.parentId === groupId));
    return [
      ...groups.map((group) => ({ kind: 'group', scopeId, groupId: group.id }) as TreeNode),
      ...this.itemNodes(scopeId, groupId),
    ];
  }

  private itemNodes(scopeId: string, groupId: string | undefined): TreeNode[] {
    const items = this.store.items(scopeId).filter((item) => item.groupId === groupId);
    return rankItems(items, {
      active: this.contextService.context(),
      usage: this.usage.all(),
      relevantOnly: this.relevantOnly,
    }).map(({ item }) => ({ kind: 'item', scopeId, itemId: item.id }) as TreeNode);
  }

  private folder(folderUri: string): vscode.WorkspaceFolder | undefined {
    return (vscode.workspace.workspaceFolders ?? []).find(
      (entry) => entry.uri.toString() === folderUri,
    );
  }

  private discoveryGroups(folderUri: string): TreeNode[] {
    const folder = this.folder(folderUri);
    if (!folder) return [];
    return this.discovery
      .groupsFor(folder)
      .map((group) => ({ kind: 'discoveryGroup', folderUri, source: group.source }) as TreeNode);
  }

  private discoveryItems(folderUri: string, source: string): TreeNode[] {
    const folder = this.folder(folderUri);
    if (!folder) return [];
    const group = this.discovery.groupsFor(folder).find((entry) => entry.source === source);
    if (!group) return [];
    return group.tasks.map(
      (task) => ({ kind: 'discoveryItem', folderUri, source: group.source, task }) as TreeNode,
    );
  }

  getParent(element: TreeNode): TreeNode | undefined {
    switch (element.kind) {
      case 'item': {
        const item = this.store.getItem({ scopeId: element.scopeId, itemId: element.itemId });
        return item?.groupId
          ? { kind: 'group', scopeId: element.scopeId, groupId: item.groupId }
          : { kind: 'scope', scopeId: element.scopeId };
      }
      case 'group': {
        const group = this.store.getGroup(element.scopeId, element.groupId);
        return group?.parentId
          ? { kind: 'group', scopeId: element.scopeId, groupId: group.parentId }
          : { kind: 'scope', scopeId: element.scopeId };
      }
      case 'error':
        return { kind: 'scope', scopeId: element.scopeId };
      case 'discoveryGroup':
        return { kind: 'discoveryRoot', folderUri: element.folderUri };
      case 'discoveryItem':
        return { kind: 'discoveryGroup', folderUri: element.folderUri, source: element.source };
      default:
        return undefined;
    }
  }

  // ------------------------------------------------------------- tree items

  getTreeItem(element: TreeNode): vscode.TreeItem {
    const item = this.buildTreeItem(element);
    item.id = nodeId(element);
    return item;
  }

  private buildTreeItem(element: TreeNode): vscode.TreeItem {
    switch (element.kind) {
      case 'scope':
        return this.scopeItem(element.scopeId);
      case 'group':
        return this.groupItem(element.scopeId, element.groupId);
      case 'item':
        return this.itemItem(element.scopeId, element.itemId);
      case 'error':
        return this.errorItem(element.scopeId);
      case 'discoveryRoot': {
        const node = new vscode.TreeItem('Discovered', vscode.TreeItemCollapsibleState.Collapsed);
        node.iconPath = new vscode.ThemeIcon('telescope');
        node.contextValue = 'discoveredRoot';
        node.tooltip = 'Tasks found in this folder. Read-only.';
        return node;
      }
      case 'discoveryGroup': {
        const folder = this.folder(element.folderUri);
        const group = folder
          ? this.discovery.groupsFor(folder).find((entry) => entry.source === element.source)
          : undefined;
        const node = new vscode.TreeItem(
          group?.label ?? element.source,
          vscode.TreeItemCollapsibleState.Collapsed,
        );
        node.iconPath = new vscode.ThemeIcon('list-tree');
        node.contextValue = 'discoveredGroup';
        return node;
      }
      case 'discoveryItem': {
        const node = new vscode.TreeItem(element.task.name, vscode.TreeItemCollapsibleState.None);
        node.iconPath = new vscode.ThemeIcon('terminal');
        node.description = element.task.detail ?? element.task.command;
        node.contextValue = 'discoveredItem';
        node.tooltip = new vscode.MarkdownString(
          `\`\`\`sh\n${element.task.command}\n\`\`\`\n\nDiscovered task — use **Copy to My Commands** to keep it.`,
        );
        node.command = {
          command: 'snipPick.runDiscovered',
          title: 'Run',
          arguments: [element],
        };
        return node;
      }
    }
  }

  private scopeItem(scopeId: string): vscode.TreeItem {
    const scope = this.store.scope(scopeId);
    const multiRoot = this.store.workspaceScopes().length > 1;
    const label = !scope
      ? scopeId
      : scope.kind === 'global'
        ? 'Global'
        : multiRoot
          ? scope.label
          : 'Workspace';
    const node = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
    node.iconPath = new vscode.ThemeIcon(scope?.kind === 'global' ? 'globe' : 'root-folder');
    node.contextValue = scope?.readonly ? 'scopeRoot.readonly' : 'scopeRoot';
    if (scope?.readonly) node.description = 'read-only';
    node.tooltip = scope ? scope.fileUri.fsPath : undefined;
    return node;
  }

  private groupItem(scopeId: string, groupId: string): vscode.TreeItem {
    const group = this.store.getGroup(scopeId, groupId);
    const readonly = this.store.scope(scopeId)?.readonly === true;
    const node = new vscode.TreeItem(
      group?.name ?? '(missing group)',
      vscode.TreeItemCollapsibleState.Collapsed,
    );
    node.iconPath = new vscode.ThemeIcon('folder');
    node.contextValue = readonly ? 'group.readonly' : 'group';
    return node;
  }

  private itemItem(scopeId: string, itemId: string): vscode.TreeItem {
    const item = this.store.getItem({ scopeId, itemId });
    const readonly = this.store.scope(scopeId)?.readonly === true;
    if (!item) return new vscode.TreeItem('(missing item)');

    const node = new vscode.TreeItem(item.title, vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon(item.type === 'snippet' ? 'symbol-snippet' : 'terminal');
    node.description = describeItem(item);
    node.tooltip = tooltipFor(item);
    node.resourceUri = itemResourceUri(scopeId, itemId);
    node.contextValue = readonly ? `${item.type}.readonly` : item.type;

    const clickAction = vscode.workspace
      .getConfiguration('snipPick')
      .get<string>('clickAction', 'insertOrRun');
    if (clickAction === 'insertOrRun') {
      node.command = {
        command: 'snipPick.activate',
        title: item.type === 'snippet' ? 'Insert' : 'Run',
        arguments: [{ kind: 'item', scopeId, itemId }],
      };
    } else if (clickAction === 'edit' && !readonly) {
      node.command = {
        command: 'snipPick.edit',
        title: 'Edit',
        arguments: [{ kind: 'item', scopeId, itemId }],
      };
    }
    return node;
  }

  private errorItem(scopeId: string): vscode.TreeItem {
    const error = this.store.errorFor(scopeId);
    const node = new vscode.TreeItem(
      'snippick.json could not be read',
      vscode.TreeItemCollapsibleState.None,
    );
    node.iconPath = new vscode.ThemeIcon('warning');
    node.description = error?.message;
    node.contextValue = 'error';
    if (error) {
      node.command = { command: 'vscode.open', title: 'Open File', arguments: [error.fileUri] };
    }
    return node;
  }

  // -------------------------------------------------------- drag and drop

  handleDrag(source: readonly TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const draggable = source.filter((node) => node.kind === 'item' || node.kind === 'group');
    if (draggable.length === 0) return;
    dataTransfer.set(DND_MIME, new vscode.DataTransferItem(draggable));
  }

  async handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    const transferred = dataTransfer.get(DND_MIME);
    const nodes = transferred?.value as TreeNode[] | undefined;
    if (!nodes || nodes.length === 0) return;
    const destination = this.dropDestination(target);
    if (!destination) return;

    try {
      for (const node of nodes) {
        if (node.kind === 'item') await this.dropItem(node.scopeId, node.itemId, destination);
        else if (node.kind === 'group')
          await this.dropGroup(node.scopeId, node.groupId, destination, target);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(`Snip Pick: ${(error as Error).message}`);
    }
  }

  private dropDestination(
    target: TreeNode | undefined,
  ): { scopeId: string; groupId: string | undefined } | undefined {
    if (!target) return { scopeId: this.store.defaultScopeId(), groupId: undefined };
    switch (target.kind) {
      case 'scope':
        return { scopeId: target.scopeId, groupId: undefined };
      case 'group':
        return { scopeId: target.scopeId, groupId: target.groupId };
      case 'item': {
        const item = this.store.getItem({ scopeId: target.scopeId, itemId: target.itemId });
        return { scopeId: target.scopeId, groupId: item?.groupId };
      }
      default:
        return undefined;
    }
  }

  private async dropItem(
    scopeId: string,
    itemId: string,
    destination: { scopeId: string; groupId: string | undefined },
  ): Promise<void> {
    if (scopeId === destination.scopeId) {
      const item = this.store.getItem({ scopeId, itemId });
      if (item?.groupId === destination.groupId) return;
      await this.store.moveItem({ scopeId, itemId }, destination.scopeId, destination.groupId);
      return;
    }
    if (!(await confirmScopeMove(this.store.scope(scopeId), this.store.scope(destination.scopeId))))
      return;
    await this.store.moveItem({ scopeId, itemId }, destination.scopeId, destination.groupId);
  }

  private async dropGroup(
    scopeId: string,
    groupId: string,
    destination: { scopeId: string; groupId: string | undefined },
    target: TreeNode | undefined,
  ): Promise<void> {
    if (scopeId !== destination.scopeId) {
      void vscode.window.showWarningMessage(
        'Snip Pick: groups cannot be dragged between scopes. Move the items instead.',
      );
      return;
    }
    const group = this.store.getGroup(scopeId, groupId);
    if (!group) return;

    // Dropping onto a sibling reorders; dropping anywhere else nests.
    if (target?.kind === 'group') {
      const sibling = this.store.getGroup(scopeId, target.groupId);
      if (sibling && sibling.id !== group.id && sibling.parentId === group.parentId) {
        await this.reorderAfter(scopeId, group.parentId, group.id, sibling.id);
        return;
      }
    }
    await this.store.reparentGroup(scopeId, groupId, destination.groupId);
  }

  private async reorderAfter(
    scopeId: string,
    parentId: string | undefined,
    movedId: string,
    afterId: string,
  ): Promise<void> {
    const siblings = sortGroups(this.store.groups(scopeId).filter((g) => g.parentId === parentId));
    const order = siblings.map((group) => group.id).filter((id) => id !== movedId);
    const index = order.indexOf(afterId);
    order.splice(index + 1, 0, movedId);
    await this.store.reorderGroups(scopeId, order);
  }
}

async function confirmScopeMove(
  from: ScopeInfo | undefined,
  to: ScopeInfo | undefined,
): Promise<boolean> {
  if (!from || !to) return false;
  const choice = await vscode.window.showWarningMessage(
    `Move from ${from.label} to ${to.label}?`,
    { modal: true, detail: 'The item will be written to a different snippick.json file.' },
    'Move',
  );
  return choice === 'Move';
}

export function describeItem(item: Item): string {
  if (item.tags.length > 0) return item.tags.map((tag) => `#${tag}`).join(' ');
  const languages = item.context?.languages;
  if (languages?.length) return languages.join(', ');
  return bodyPreview(item, 60);
}

export function tooltipFor(item: Item): vscode.MarkdownString {
  const language = item.type === 'command' ? 'sh' : (item.context?.languages?.[0] ?? '');
  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**${escapeMarkdown(item.title)}**\n\n`);
  if (item.description) markdown.appendMarkdown(`${escapeMarkdown(item.description)}\n\n`);
  markdown.appendCodeblock(item.type === 'command' ? commandText(item) : item.body, language);
  if (item.tags.length > 0) {
    markdown.appendMarkdown(`\n${item.tags.map((tag) => `\`#${tag}\``).join(' ')}`);
  }
  return markdown;
}

function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, '\\$1');
}
