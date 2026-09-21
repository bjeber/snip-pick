import * as vscode from 'vscode';
import type { RelevanceContext } from './relevance';

/**
 * Tracks what the user is looking at: the active document's language and path, plus the marker
 * files at the root of its workspace folder. Marker listings are cached and refreshed when files
 * at a folder root appear or disappear.
 */
export class ContextService implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly watchers: vscode.Disposable[] = [];
  private readonly markerCache = new Map<string, string[]>();
  private current: RelevanceContext = {};
  private folder: vscode.WorkspaceFolder | undefined;

  readonly onDidChange = this.emitter.event;

  constructor() {
    this.disposables.push(
      this.emitter,
      vscode.window.onDidChangeActiveTextEditor((editor) => void this.update(editor)),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshMarkers()),
    );
  }

  async initialize(): Promise<void> {
    await this.refreshMarkers();
    await this.update(vscode.window.activeTextEditor);
  }

  dispose(): void {
    vscode.Disposable.from(...this.watchers, ...this.disposables).dispose();
  }

  /** The context used for relevance scoring. */
  context(): RelevanceContext {
    return this.current;
  }

  /** Workspace folder of the active file, falling back to the first folder. */
  activeFolder(): vscode.WorkspaceFolder | undefined {
    return this.folder ?? vscode.workspace.workspaceFolders?.[0];
  }

  markersFor(folder: vscode.WorkspaceFolder): readonly string[] {
    return this.markerCache.get(folder.uri.toString()) ?? [];
  }

  private async update(editor: vscode.TextEditor | undefined): Promise<void> {
    // Keep the last known file context when focus moves to a terminal or settings editor: the
    // user is still "working on" that file.
    if (!editor || editor.document.uri.scheme === 'output') return;
    const uri = editor.document.uri;
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    this.folder = folder;
    const next: RelevanceContext = { languageId: editor.document.languageId };
    if (folder) {
      next.relativePath = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
      next.markers = this.markersFor(folder);
    } else {
      next.relativePath = uri.path.replace(/^\//, '');
    }
    if (
      next.languageId === this.current.languageId &&
      next.relativePath === this.current.relativePath &&
      next.markers === this.current.markers
    ) {
      return;
    }
    this.current = next;
    this.emitter.fire();
  }

  private async refreshMarkers(): Promise<void> {
    vscode.Disposable.from(...this.watchers.splice(0)).dispose();
    this.markerCache.clear();
    const folders = vscode.workspace.workspaceFolders ?? [];
    await Promise.all(folders.map((folder) => this.readMarkers(folder)));
    for (const folder of folders) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, '*'),
        false,
        true,
        false,
      );
      const refresh = () => void this.readMarkers(folder).then(() => this.reapplyMarkers(folder));
      watcher.onDidCreate(refresh);
      watcher.onDidDelete(refresh);
      this.watchers.push(watcher);
    }
    this.reapplyMarkers(this.folder);
  }

  private async readMarkers(folder: vscode.WorkspaceFolder): Promise<void> {
    try {
      const entries = await vscode.workspace.fs.readDirectory(folder.uri);
      this.markerCache.set(
        folder.uri.toString(),
        entries.map(([name]) => name),
      );
    } catch {
      this.markerCache.set(folder.uri.toString(), []);
    }
  }

  private reapplyMarkers(folder: vscode.WorkspaceFolder | undefined): void {
    const target = folder ?? this.folder;
    if (!target) return;
    this.current = { ...this.current, markers: this.markersFor(target) };
    this.emitter.fire();
  }
}
