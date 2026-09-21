import * as vscode from 'vscode';
import { log } from '../log';
import {
  descendantGroupIds,
  emptyFile,
  mergeFiles,
  newId,
  normalizeFile,
  parseFile,
  serializeFile,
  wouldCreateCycle,
  type Group,
  type Item,
  type MergeResult,
  type MergeStrategy,
  type Scope,
  type SnipPickFile,
} from '@snip-pick/core';

/** Scope ids are runtime-only; nothing on disk keys off them. */
export const USER_SCOPE_ID = 'user';
const RELOAD_DEBOUNCE_MS = 250;

export interface ScopeInfo {
  id: string;
  kind: Scope;
  label: string;
  /** Workspace scopes are read-only in untrusted workspaces. */
  readonly: boolean;
  fileUri: vscode.Uri;
  folder?: vscode.WorkspaceFolder;
}

export interface ItemRef {
  scopeId: string;
  itemId: string;
}

export interface ResolvedItem {
  scopeId: string;
  item: Item;
}

export interface ScopeError {
  message: string;
  fileUri: vscode.Uri;
}

export class ReadOnlyScopeError extends Error {
  constructor(label: string) {
    super(`"${label}" is read-only in this workspace.`);
    this.name = 'ReadOnlyScopeError';
  }
}

class ScopeState {
  file: SnipPickFile = emptyFile();
  error: ScopeError | undefined;
  /** Text of the last write we performed, so our own writes do not trigger a reload. */
  lastWritten: string | undefined;
  exists = false;

  constructor(public info: ScopeInfo) {}
}

/**
 * Owns every `snippick.json` the extension knows about: one global file plus one per workspace
 * folder. All mutations go through here, and a single event tells the UI to refresh.
 */
export class Store implements vscode.Disposable {
  private readonly states = new Map<string, ScopeState>();
  private readonly watchers: vscode.Disposable[] = [];
  private readonly reloadTimers = new Map<string, NodeJS.Timeout>();
  private readonly reportedErrors = new Set<string>();
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.emitter.event;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.disposables.push(
      this.emitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshScopes()),
      vscode.workspace.onDidGrantWorkspaceTrust(() => void this.refreshScopes()),
    );
  }

  async initialize(): Promise<void> {
    await this.refreshScopes();
  }

  dispose(): void {
    for (const timer of this.reloadTimers.values()) clearTimeout(timer);
    this.reloadTimers.clear();
    vscode.Disposable.from(...this.watchers, ...this.disposables).dispose();
  }

  // ---------------------------------------------------------------- scopes

  scopes(): ScopeInfo[] {
    return [...this.states.values()].map((state) => state.info);
  }

  scope(scopeId: string): ScopeInfo | undefined {
    return this.states.get(scopeId)?.info;
  }

  workspaceScopes(): ScopeInfo[] {
    return this.scopes().filter((scope) => scope.kind === 'workspace');
  }

  errorFor(scopeId: string): ScopeError | undefined {
    return this.states.get(scopeId)?.error;
  }

  /** The default scope for new items, honouring `snipPick.defaultScope` and workspace trust. */
  defaultScopeId(): string {
    const preference = vscode.workspace
      .getConfiguration('snipPick')
      .get<Scope>('defaultScope', 'user');
    if (preference === 'workspace') {
      const writable = this.workspaceScopes().find((scope) => !scope.readonly);
      if (writable) return writable.id;
    }
    return USER_SCOPE_ID;
  }

  private async refreshScopes(): Promise<void> {
    vscode.Disposable.from(...this.watchers.splice(0)).dispose();

    const wanted = new Map<string, ScopeInfo>();
    wanted.set(USER_SCOPE_ID, {
      id: USER_SCOPE_ID,
      kind: 'user',
      label: 'User',
      readonly: false,
      fileUri: vscode.Uri.joinPath(this.context.globalStorageUri, 'snippick.json'),
    });
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      wanted.set(folder.uri.toString(), {
        id: folder.uri.toString(),
        kind: 'workspace',
        label: folder.name,
        readonly: !vscode.workspace.isTrusted,
        fileUri: vscode.Uri.joinPath(folder.uri, '.vscode', 'snippick.json'),
        folder,
      });
    }

    for (const id of [...this.states.keys()]) {
      if (!wanted.has(id)) this.states.delete(id);
    }
    for (const [id, info] of wanted) {
      const existing = this.states.get(id);
      if (existing) existing.info = info;
      else this.states.set(id, new ScopeState(info));
    }

    await Promise.all([...this.states.keys()].map((id) => this.load(id)));
    this.watchWorkspaceFiles();
    this.emitter.fire();
  }

  private watchWorkspaceFiles(): void {
    for (const scope of this.workspaceScopes()) {
      if (!scope.folder) continue;
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(scope.folder, '.vscode/snippick.json'),
      );
      const schedule = () => this.scheduleReload(scope.id);
      watcher.onDidChange(schedule);
      watcher.onDidCreate(schedule);
      watcher.onDidDelete(schedule);
      this.watchers.push(watcher);
    }
  }

  private scheduleReload(scopeId: string): void {
    const existing = this.reloadTimers.get(scopeId);
    if (existing) clearTimeout(existing);
    this.reloadTimers.set(
      scopeId,
      setTimeout(() => {
        this.reloadTimers.delete(scopeId);
        void this.load(scopeId).then(() => this.emitter.fire());
      }, RELOAD_DEBOUNCE_MS),
    );
  }

  // ------------------------------------------------------------------ io

  private async load(scopeId: string): Promise<void> {
    const state = this.states.get(scopeId);
    if (!state) return;
    let bytes: Uint8Array;
    try {
      bytes = await vscode.workspace.fs.readFile(state.info.fileUri);
    } catch {
      // Files are created lazily, so "not found" is the normal case.
      state.file = emptyFile();
      state.error = undefined;
      state.exists = false;
      state.lastWritten = undefined;
      return;
    }
    state.exists = true;
    const text = new TextDecoder().decode(bytes);
    if (text === state.lastWritten) return;

    const result = parseFile(text);
    if (!result.ok) {
      state.error = {
        message: result.errors.slice(0, 5).join('; '),
        fileUri: state.info.fileUri,
      };
      log().error(`Failed to read ${state.info.fileUri.fsPath}: ${state.error.message}`);
      this.reportError(state.info, state.error);
      // Keep serving the last good in-memory state and never overwrite the broken file.
      return;
    }
    state.error = undefined;
    state.lastWritten = text;
    state.file = normalizeFile(result.file);
    this.reportedErrors.delete(scopeId);
    log().debug(
      `Loaded ${state.file.items.length} items from ${state.info.fileUri.fsPath} (${scopeId})`,
    );
  }

  private reportError(info: ScopeInfo, error: ScopeError): void {
    if (this.reportedErrors.has(info.id)) return;
    this.reportedErrors.add(info.id);
    void vscode.window
      .showErrorMessage(
        `Snip Pick could not read ${info.label}: ${error.message}`,
        'Open File',
        'Show Log',
      )
      .then((choice) => {
        if (choice === 'Open File') void vscode.window.showTextDocument(error.fileUri);
        else if (choice === 'Show Log') log().show();
      });
  }

  /** Atomic write: temp file first, then rename over the target. */
  private async persist(scopeId: string): Promise<void> {
    const state = this.states.get(scopeId);
    if (!state) return;
    if (state.error) {
      throw new Error(
        `Refusing to overwrite ${state.info.fileUri.fsPath} while it contains errors.`,
      );
    }
    const text = serializeFile(state.file);
    const bytes = new TextEncoder().encode(text);
    const target = state.info.fileUri;
    const directory = vscode.Uri.joinPath(target, '..');
    await vscode.workspace.fs.createDirectory(directory);
    const temp = vscode.Uri.joinPath(directory, `.snippick.${process.pid}.${Date.now()}.tmp`);
    try {
      await vscode.workspace.fs.writeFile(temp, bytes);
      await vscode.workspace.fs.rename(temp, target, { overwrite: true });
    } catch (error) {
      await vscode.workspace.fs.delete(temp, { useTrash: false }).then(undefined, () => undefined);
      throw error;
    }
    state.lastWritten = text;
    state.exists = true;
  }

  private assertWritable(scopeId: string): ScopeState {
    const state = this.states.get(scopeId);
    if (!state) throw new Error(`Unknown scope: ${scopeId}`);
    if (state.info.readonly) throw new ReadOnlyScopeError(state.info.label);
    return state;
  }

  private async mutate(scopeId: string, change: (file: SnipPickFile) => void): Promise<void> {
    const state = this.assertWritable(scopeId);
    const draft: SnipPickFile = {
      schemaVersion: state.file.schemaVersion,
      groups: state.file.groups.map((group) => ({ ...group })),
      items: state.file.items.map((item) => ({ ...item })),
    };
    change(draft);
    state.file = normalizeFile(draft);
    await this.persist(scopeId);
    this.emitter.fire();
  }

  // --------------------------------------------------------------- reads

  file(scopeId: string): SnipPickFile {
    return this.states.get(scopeId)?.file ?? emptyFile();
  }

  groups(scopeId: string): Group[] {
    return this.file(scopeId).groups;
  }

  items(scopeId: string): Item[] {
    return this.file(scopeId).items;
  }

  allItems(): ResolvedItem[] {
    const out: ResolvedItem[] = [];
    for (const state of this.states.values()) {
      for (const item of state.file.items) out.push({ scopeId: state.info.id, item });
    }
    return out;
  }

  getItem(ref: ItemRef): Item | undefined {
    return this.file(ref.scopeId).items.find((item) => item.id === ref.itemId);
  }

  getGroup(scopeId: string, groupId: string): Group | undefined {
    return this.file(scopeId).groups.find((group) => group.id === groupId);
  }

  isEmpty(): boolean {
    return (
      this.allItems().length === 0 && this.scopes().every((s) => this.groups(s.id).length === 0)
    );
  }

  // ------------------------------------------------------------- mutations

  async addItem(scopeId: string, item: Item): Promise<Item> {
    await this.mutate(scopeId, (file) => {
      file.items.push(item);
    });
    return item;
  }

  async updateItem(ref: ItemRef, patch: Partial<Item>): Promise<void> {
    await this.mutate(ref.scopeId, (file) => {
      const index = file.items.findIndex((item) => item.id === ref.itemId);
      if (index === -1) return;
      file.items[index] = { ...file.items[index]!, ...patch, updatedAt: Date.now() };
    });
  }

  async deleteItem(ref: ItemRef): Promise<void> {
    await this.mutate(ref.scopeId, (file) => {
      file.items = file.items.filter((item) => item.id !== ref.itemId);
    });
  }

  /** Moves an item within or across scopes, optionally into `groupId`. */
  async moveItem(ref: ItemRef, targetScopeId: string, groupId: string | undefined): Promise<void> {
    const item = this.getItem(ref);
    if (!item) return;
    if (ref.scopeId === targetScopeId) {
      await this.updateItem(ref, groupId === undefined ? { groupId: undefined } : { groupId });
      return;
    }
    this.assertWritable(targetScopeId);
    this.assertWritable(ref.scopeId);
    const moved: Item = { ...item, updatedAt: Date.now() };
    if (groupId === undefined) delete moved.groupId;
    else moved.groupId = groupId;
    await this.mutate(targetScopeId, (file) => {
      file.items.push(moved);
    });
    await this.deleteItem(ref);
  }

  async addGroup(scopeId: string, name: string, parentId?: string): Promise<Group> {
    const siblings = this.groups(scopeId).filter((group) => group.parentId === parentId);
    const order = siblings.reduce((max, group) => Math.max(max, group.order), -1) + 1;
    const group: Group = { id: newId(), name, order };
    if (parentId !== undefined) group.parentId = parentId;
    await this.mutate(scopeId, (file) => {
      file.groups.push(group);
    });
    return group;
  }

  async renameGroup(scopeId: string, groupId: string, name: string): Promise<void> {
    await this.mutate(scopeId, (file) => {
      const group = file.groups.find((entry) => entry.id === groupId);
      if (group) group.name = name;
    });
  }

  /** Re-parents a group, refusing moves that would create a cycle. */
  async reparentGroup(
    scopeId: string,
    groupId: string,
    parentId: string | undefined,
  ): Promise<void> {
    if (wouldCreateCycle(this.groups(scopeId), groupId, parentId)) {
      throw new Error('A group cannot be moved into one of its own children.');
    }
    await this.mutate(scopeId, (file) => {
      const group = file.groups.find((entry) => entry.id === groupId);
      if (!group) return;
      if (parentId === undefined) delete group.parentId;
      else group.parentId = parentId;
      const siblings = file.groups.filter(
        (entry) => entry.parentId === parentId && entry.id !== groupId,
      );
      group.order = siblings.reduce((max, entry) => Math.max(max, entry.order), -1) + 1;
    });
  }

  /** Writes a new sibling order for the given group ids, in array order. */
  async reorderGroups(scopeId: string, orderedIds: readonly string[]): Promise<void> {
    await this.mutate(scopeId, (file) => {
      orderedIds.forEach((id, index) => {
        const group = file.groups.find((entry) => entry.id === id);
        if (group) group.order = index;
      });
    });
  }

  async deleteGroup(
    scopeId: string,
    groupId: string,
    mode: 'deleteItems' | 'moveToParent',
  ): Promise<void> {
    await this.mutate(scopeId, (file) => {
      const group = file.groups.find((entry) => entry.id === groupId);
      if (!group) return;
      const parentId = group.parentId;
      if (mode === 'deleteItems') {
        const doomed = new Set([groupId, ...descendantGroupIds(file.groups, groupId)]);
        file.groups = file.groups.filter((entry) => !doomed.has(entry.id));
        file.items = file.items.filter(
          (item) => item.groupId === undefined || !doomed.has(item.groupId),
        );
        return;
      }
      file.groups = file.groups.filter((entry) => entry.id !== groupId);
      for (const child of file.groups) {
        if (child.parentId === groupId) {
          if (parentId === undefined) delete child.parentId;
          else child.parentId = parentId;
        }
      }
      for (const item of file.items) {
        if (item.groupId === groupId) {
          if (parentId === undefined) delete item.groupId;
          else item.groupId = parentId;
        }
      }
    });
  }

  /** Replaces a whole scope, used by import. */
  async importFile(
    scopeId: string,
    incoming: SnipPickFile,
    strategy: MergeStrategy,
  ): Promise<MergeResult> {
    const state = this.assertWritable(scopeId);
    const result = mergeFiles(state.file, incoming, strategy);
    await this.mutate(scopeId, (file) => {
      file.groups = result.file.groups;
      file.items = result.file.items;
    });
    return result;
  }

  /** Makes sure the backing file exists, so "Edit as JSON" has something to open. */
  async ensureFile(scopeId: string): Promise<vscode.Uri> {
    const state = this.states.get(scopeId);
    if (!state) throw new Error(`Unknown scope: ${scopeId}`);
    if (!state.exists && !state.info.readonly) await this.persist(scopeId);
    return state.info.fileUri;
  }

  /** Forces a reload of every scope, e.g. from the Refresh action. */
  async reloadAll(): Promise<void> {
    this.reportedErrors.clear();
    for (const state of this.states.values()) state.lastWritten = undefined;
    await Promise.all([...this.states.keys()].map((id) => this.load(id)));
    this.emitter.fire();
  }

  notifyChanged(): void {
    this.emitter.fire();
  }
}
