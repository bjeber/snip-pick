import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { SnipPickApi } from '../../src/extension';
import type { Item } from '../../src/model/types';
import { GLOBAL_SCOPE_ID } from '../../src/store/store';

const EXTENSION_ID = 'bieber.snip-pick';

const EXPECTED_COMMANDS = [
  'snipPick.open',
  'snipPick.addSnippet',
  'snipPick.addSnippetFromSelection',
  'snipPick.addCommand',
  'snipPick.newGroup',
  'snipPick.insert',
  'snipPick.run',
  'snipPick.copy',
  'snipPick.edit',
  'snipPick.editAsJson',
  'snipPick.delete',
  'snipPick.togglePin',
  'snipPick.duplicate',
  'snipPick.moveToGroup',
  'snipPick.renameGroup',
  'snipPick.deleteGroup',
  'snipPick.toggleRelevantOnly',
  'snipPick.refresh',
  'snipPick.export',
  'snipPick.import',
  'snipPick.importCodeSnippets',
  'snipPick.exportCodeSnippets',
  'snipPick.setSecret',
  'snipPick.clearSecrets',
  'snipPick.copyDiscovered',
];

function makeItem(overrides: Partial<Item> = {}): Item {
  const now = Date.now();
  return {
    id: `test-${Math.random().toString(36).slice(2)}`,
    type: 'snippet',
    title: 'Test item',
    body: 'hello',
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

suite('Snip Pick', () => {
  let api: SnipPickApi;
  const created: Array<{ scopeId: string; itemId: string }> = [];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<SnipPickApi>(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} should be installed`);
    api = await extension.activate();
  });

  teardown(async () => {
    while (created.length > 0) {
      const ref = created.pop()!;
      await api.store.deleteItem(ref).catch(() => undefined);
    }
  });

  async function add(scopeId: string, overrides: Partial<Item> = {}): Promise<Item> {
    const item = makeItem(overrides);
    await api.store.addItem(scopeId, item);
    created.push({ scopeId, itemId: item.id });
    return item;
  }

  test('activates', () => {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.equal(extension?.isActive, true);
  });

  test('registers every contributed command', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      assert.ok(commands.includes(command), `${command} should be registered`);
    }
  });

  test('exposes a global scope and one scope per workspace folder', () => {
    const scopes = api.store.scopes();
    assert.ok(scopes.some((scope) => scope.id === GLOBAL_SCOPE_ID));
    assert.equal(
      scopes.filter((scope) => scope.kind === 'workspace').length,
      vscode.workspace.workspaceFolders?.length ?? 0,
    );
  });

  test('renders scopes, groups and items in the tree', async () => {
    const group = await api.store.addGroup(GLOBAL_SCOPE_ID, 'Tree group');
    const item = await add(GLOBAL_SCOPE_ID, { title: 'Grouped', groupId: group.id });
    try {
      const roots = api.tree.getChildren();
      assert.ok(roots.length >= 1);
      const globalRoot = roots.find(
        (node) => node.kind === 'scope' && node.scopeId === GLOBAL_SCOPE_ID,
      );
      assert.ok(globalRoot, 'the Global root should exist');

      const children = api.tree.getChildren(globalRoot);
      const groupNode = children.find((node) => node.kind === 'group' && node.groupId === group.id);
      assert.ok(groupNode, 'the group should be a child of its scope');
      assert.equal(api.tree.getTreeItem(groupNode).label, 'Tree group');

      const itemNodes = api.tree.getChildren(groupNode);
      assert.equal(itemNodes.length, 1);
      const treeItem = api.tree.getTreeItem(itemNodes[0]!);
      assert.equal(treeItem.label, 'Grouped');
      assert.equal(treeItem.contextValue, 'snippet');
      assert.equal(api.tree.getParent(itemNodes[0]!)?.kind, 'group');
      assert.equal(treeItem.command?.command, 'snipPick.activate');
      assert.ok(String(item.id).length > 0);
    } finally {
      await api.store.deleteGroup(GLOBAL_SCOPE_ID, group.id, 'deleteItems');
    }
  });

  test('inserts a snippet into the active editor', async () => {
    const item = await add(GLOBAL_SCOPE_ID, {
      title: 'Logger',
      body: 'console.log($1);',
    });
    const document = await vscode.workspace.openTextDocument({
      content: '',
      language: 'javascript',
    });
    await vscode.window.showTextDocument(document);

    await vscode.commands.executeCommand('snipPick.insert', {
      kind: 'item',
      scopeId: GLOBAL_SCOPE_ID,
      itemId: item.id,
    });

    assert.equal(document.getText(), 'console.log();');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('copies an item to the clipboard', async () => {
    const item = await add(GLOBAL_SCOPE_ID, { type: 'command', body: 'echo hi' });
    await vscode.commands.executeCommand('snipPick.copy', {
      kind: 'item',
      scopeId: GLOBAL_SCOPE_ID,
      itemId: item.id,
    });
    assert.equal(await vscode.env.clipboard.readText(), 'echo hi');
  });

  test('pins and unpins', async () => {
    const item = await add(GLOBAL_SCOPE_ID);
    const ref = { kind: 'item', scopeId: GLOBAL_SCOPE_ID, itemId: item.id };
    await vscode.commands.executeCommand('snipPick.togglePin', ref);
    assert.equal(api.store.getItem({ scopeId: GLOBAL_SCOPE_ID, itemId: item.id })?.pinned, true);
    await vscode.commands.executeCommand('snipPick.togglePin', ref);
    assert.equal(
      api.store.getItem({ scopeId: GLOBAL_SCOPE_ID, itemId: item.id })?.pinned,
      undefined,
    );
  });

  test('persists items to disk and reloads them', async () => {
    const item = await add(GLOBAL_SCOPE_ID, { title: 'Persisted' });
    const uri = await api.store.ensureFile(GLOBAL_SCOPE_ID);
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    assert.ok(text.includes('"Persisted"'));
    assert.ok(text.endsWith('\n'));

    await api.store.reloadAll();
    assert.equal(
      api.store.getItem({ scopeId: GLOBAL_SCOPE_ID, itemId: item.id })?.title,
      'Persisted',
    );
  });

  test('writes workspace items into .vscode/snippick.json', async () => {
    const scope = api.store.workspaceScopes()[0];
    assert.ok(scope, 'the test workspace folder should be a scope');
    assert.equal(scope.readonly, false, 'the test workspace should be trusted');
    const item = await add(scope.id, { title: 'Workspace item' });
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(scope.fileUri));
    assert.ok(text.includes('Workspace item'));
    assert.ok(scope.fileUri.path.endsWith('/.vscode/snippick.json'));
    assert.ok(item.id.length > 0);
  });

  test('discovers package.json scripts in the test workspace', () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder);
    const groups = api.discovery.groupsFor(folder);
    const npm = groups.find((group) => group.source === 'npm');
    assert.ok(npm, 'package.json scripts should be discovered');
    assert.deepEqual(npm.tasks.map((task) => task.name).sort(), ['build', 'test']);
  });

  test('ranks relevant items above the rest', async () => {
    const relevant = await add(GLOBAL_SCOPE_ID, {
      title: 'Zeta relevant',
      context: { languages: ['javascript'] },
    });
    await add(GLOBAL_SCOPE_ID, { title: 'Alpha neutral' });

    const document = await vscode.workspace.openTextDocument({
      content: '',
      language: 'javascript',
    });
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const scopeNode = { kind: 'scope', scopeId: GLOBAL_SCOPE_ID } as const;
    const items = api.tree
      .getChildren(scopeNode)
      .filter((node) => node.kind === 'item')
      .map((node) => (node.kind === 'item' ? node.itemId : ''));
    assert.equal(items[0], relevant.id, 'the language match should come first');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
