import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';
import type { SnipPickApi } from '../../src/extension';
import type { Item } from '@snip-pick/contracts';

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
  'snipPick.signIn',
  'snipPick.signOut',
  'snipPick.setServerUrl',
  'snipPick.resolveConflicts',
  'snipPick.selectVaults',
  'snipPick.refreshRemote',
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
  let USER_SCOPE_ID: string;
  const created: Array<{ scopeId: string; itemId: string }> = [];

  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension<SnipPickApi>(EXTENSION_ID);
    assert.ok(extension, `${EXTENSION_ID} should be installed`);
    api = await extension.activate();
    const user = api.store.scopes().find((scope) => scope.kind === 'user');
    assert.ok(user, 'the extension should expose a user-level scope');
    USER_SCOPE_ID = user.id;
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

  test('exposes a user level and one workspace level per folder', () => {
    const scopes = api.store.scopes();

    // User level: follows the person across every project they open.
    const user = scopes.find((scope) => scope.id === USER_SCOPE_ID);
    assert.ok(user, 'there should be a user-level scope');
    assert.equal(user.kind, 'user');
    assert.equal(user.id, 'user');
    assert.ok(
      !user.fileUri.path.includes('/.vscode/'),
      'the user library lives in global storage, not in any project',
    );

    // Workspace level: inside the project, under .vscode/, so it can be committed.
    const workspaces = scopes.filter((scope) => scope.kind === 'workspace');
    assert.equal(workspaces.length, vscode.workspace.workspaceFolders?.length ?? 0);
    for (const scope of workspaces) {
      assert.ok(
        scope.fileUri.path.endsWith('/.vscode/snippick.json'),
        'a workspace library must live in the project so it can be committed',
      );
      const folder = vscode.workspace.workspaceFolders?.find((entry) =>
        scope.fileUri.path.startsWith(entry.uri.path),
      );
      assert.ok(folder, 'the workspace library must sit inside its own folder');
    }
  });

  test('keeps the two local levels independent', async () => {
    const workspace = api.store.workspaceScopes()[0];
    assert.ok(workspace);

    const userItem = await add(USER_SCOPE_ID, { title: 'User level' });
    const workspaceItem = await add(workspace.id, { title: 'Project level' });

    const userIds = api.store.items(USER_SCOPE_ID).map((entry) => entry.id);
    const workspaceIds = api.store.items(workspace.id).map((entry) => entry.id);
    assert.ok(userIds.includes(userItem.id));
    assert.ok(!userIds.includes(workspaceItem.id), 'levels must not leak into each other');
    assert.ok(workspaceIds.includes(workspaceItem.id));
    assert.ok(!workspaceIds.includes(userItem.id));

    // Both are visible at once, which is the point of having levels rather than a mode.
    const everything = api.store.allItems().map((entry) => entry.item.id);
    assert.ok(everything.includes(userItem.id) && everything.includes(workspaceItem.id));
  });

  test('renders scopes, groups and items in the tree', async () => {
    const group = await api.store.addGroup(USER_SCOPE_ID, 'Tree group');
    const item = await add(USER_SCOPE_ID, { title: 'Grouped', groupId: group.id });
    try {
      const roots = api.tree.getChildren();
      assert.ok(roots.length >= 1);
      const globalRoot = roots.find(
        (node) => node.kind === 'scope' && node.scopeId === USER_SCOPE_ID,
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
      await api.store.deleteGroup(USER_SCOPE_ID, group.id, 'deleteItems');
    }
  });

  test('refuses to drag an item into another scope by default', async () => {
    const workspace = api.store.workspaceScopes().find((scope) => !scope.readonly);
    assert.ok(workspace, 'the fixture workspace should be writable');
    assert.equal(
      vscode.workspace.getConfiguration('snipPick').get<boolean>('allowCrossScopeDrag'),
      false,
      'snipPick.allowCrossScopeDrag must ship disabled',
    );

    const item = await add(USER_SCOPE_ID, { title: 'Stays put' });
    const transfer = new vscode.DataTransfer();
    api.tree.handleDrag([{ kind: 'item', scopeId: USER_SCOPE_ID, itemId: item.id }], transfer);
    await api.tree.handleDrop({ kind: 'scope', scopeId: workspace.id }, transfer);

    assert.ok(
      api.store.items(USER_SCOPE_ID).some((entry) => entry.id === item.id),
      'the item should still be in the scope it was dragged from',
    );
    assert.ok(
      !api.store.items(workspace.id).some((entry) => entry.id === item.id),
      'a refused drop must not write to the other scope at all',
    );
  });

  test('still drags an item between groups of one scope', async () => {
    const group = await api.store.addGroup(USER_SCOPE_ID, 'Drop target');
    try {
      const item = await add(USER_SCOPE_ID, { title: 'Moves within User' });
      const transfer = new vscode.DataTransfer();
      api.tree.handleDrag([{ kind: 'item', scopeId: USER_SCOPE_ID, itemId: item.id }], transfer);
      await api.tree.handleDrop(
        { kind: 'group', scopeId: USER_SCOPE_ID, groupId: group.id },
        transfer,
      );

      assert.equal(
        api.store.getItem({ scopeId: USER_SCOPE_ID, itemId: item.id })?.groupId,
        group.id,
        'the cross-scope guard must not affect drags inside one scope',
      );
    } finally {
      await api.store.deleteGroup(USER_SCOPE_ID, group.id, 'deleteItems');
    }
  });

  test('renders the remote rows for a configured server', async () => {
    // Workspace target, so this lands in the fixture rather than in the settings of whatever
    // VS Code is running the suite.
    const config = vscode.workspace.getConfiguration('snipPick');
    await config.update(
      'remote.url',
      'http://localhost:8787',
      vscode.ConfigurationTarget.Workspace,
    );
    try {
      await api.remote.refresh();
      const signIn = api.tree.getChildren().find((node) => node.kind === 'signIn');
      assert.ok(signIn, 'a configured server should offer a way to sign in');

      const item = api.tree.getTreeItem(signIn);
      assert.equal(item.label, 'Sign in');
      assert.equal(
        item.description,
        'localhost:8787',
        'the row shows the host; the scheme is the least informative part of the URL',
      );
      assert.equal(item.command?.command, 'snipPick.signIn');
      assert.equal(item.contextValue, 'signIn', 'the gear that edits the server hangs off this');
    } finally {
      await config.update('remote.url', undefined, vscode.ConfigurationTarget.Workspace);
      await api.remote.refresh();
    }
  });

  test('inserts a snippet into the active editor', async () => {
    const item = await add(USER_SCOPE_ID, {
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
      scopeId: USER_SCOPE_ID,
      itemId: item.id,
    });

    assert.equal(document.getText(), 'console.log();');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });

  test('copies an item to the clipboard', async () => {
    const item = await add(USER_SCOPE_ID, { type: 'command', body: 'echo hi' });
    await vscode.commands.executeCommand('snipPick.copy', {
      kind: 'item',
      scopeId: USER_SCOPE_ID,
      itemId: item.id,
    });
    assert.equal(await vscode.env.clipboard.readText(), 'echo hi');
  });

  test('pins and unpins', async () => {
    const item = await add(USER_SCOPE_ID);
    const ref = { kind: 'item', scopeId: USER_SCOPE_ID, itemId: item.id };
    await vscode.commands.executeCommand('snipPick.togglePin', ref);
    assert.equal(api.store.getItem({ scopeId: USER_SCOPE_ID, itemId: item.id })?.pinned, true);
    await vscode.commands.executeCommand('snipPick.togglePin', ref);
    assert.equal(api.store.getItem({ scopeId: USER_SCOPE_ID, itemId: item.id })?.pinned, undefined);
  });

  test('persists items to disk and reloads them', async () => {
    const item = await add(USER_SCOPE_ID, { title: 'Persisted' });
    const uri = await api.store.ensureFile(USER_SCOPE_ID);
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    assert.ok(text.includes('"Persisted"'));
    assert.ok(text.endsWith('\n'));

    await api.store.reloadAll();
    assert.equal(
      api.store.getItem({ scopeId: USER_SCOPE_ID, itemId: item.id })?.title,
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

  test('starts fully local, with no server configured and no session', () => {
    assert.equal(
      vscode.workspace.getConfiguration('snipPick').get<string>('remote.url'),
      '',
      'the extension should be local-only until a server is configured',
    );
    assert.equal(api.remote.signedIn(), false);
    assert.deepEqual([...api.remote.vaults()], []);
    assert.deepEqual(api.remote.mounted(), []);
  });

  test('contributes an authentication provider', async () => {
    // getSession with createIfNone:false must resolve (not throw) for a registered provider.
    const session = await vscode.authentication.getSession('snip-pick', ['openid'], {
      createIfNone: false,
    });
    assert.equal(session, undefined, 'there should be no session before signing in');
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
    const relevant = await add(USER_SCOPE_ID, {
      title: 'Zeta relevant',
      context: { languages: ['javascript'] },
    });
    await add(USER_SCOPE_ID, { title: 'Alpha neutral' });

    const document = await vscode.workspace.openTextDocument({
      content: '',
      language: 'javascript',
    });
    await vscode.window.showTextDocument(document);
    await new Promise((resolve) => setTimeout(resolve, 250));

    const scopeNode = { kind: 'scope', scopeId: USER_SCOPE_ID } as const;
    const items = api.tree
      .getChildren(scopeNode)
      .filter((node) => node.kind === 'item')
      .map((node) => (node.kind === 'item' ? node.itemId : ''));
    assert.equal(items[0], relevant.id, 'the language match should come first');
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  });
});
