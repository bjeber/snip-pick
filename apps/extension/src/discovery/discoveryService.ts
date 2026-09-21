import * as vscode from 'vscode';
import { log } from '../log';
import {
  detectPackageManager,
  parseJustfileRecipes,
  parseMakefileTargets,
  parsePackageScripts,
  type DiscoveredTask,
} from '@snip-pick/core';

export type DiscoverySource = 'npm' | 'make' | 'just';

export interface DiscoveredGroup {
  source: DiscoverySource;
  label: string;
  tasks: DiscoveredTask[];
}

const MAKEFILES = ['Makefile', 'makefile', 'GNUmakefile'];
const JUSTFILES = ['justfile', 'Justfile', '.justfile'];
const WATCH_PATTERN = '{package.json,Makefile,makefile,GNUmakefile,justfile,Justfile,.justfile}';

/**
 * Read-only "Discovered" tasks: `package.json` scripts, Makefile targets and justfile recipes of
 * each workspace folder.
 */
export class DiscoveryService implements vscode.Disposable {
  private readonly cache = new Map<string, DiscoveredGroup[]>();
  private readonly emitter = new vscode.EventEmitter<void>();
  private readonly watchers: vscode.Disposable[] = [];
  private readonly disposables: vscode.Disposable[] = [];

  readonly onDidChange = this.emitter.event;

  constructor() {
    this.disposables.push(
      this.emitter,
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refresh()),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('snipPick.discovery.enabled')) void this.refresh();
      }),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.watchers, ...this.disposables).dispose();
  }

  get enabled(): boolean {
    return vscode.workspace.getConfiguration('snipPick').get<boolean>('discovery.enabled', true);
  }

  groupsFor(folder: vscode.WorkspaceFolder): DiscoveredGroup[] {
    return this.cache.get(folder.uri.toString()) ?? [];
  }

  async refresh(): Promise<void> {
    vscode.Disposable.from(...this.watchers.splice(0)).dispose();
    this.cache.clear();
    if (this.enabled) {
      const folders = vscode.workspace.workspaceFolders ?? [];
      await Promise.all(folders.map((folder) => this.scan(folder)));
      for (const folder of folders) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(folder, WATCH_PATTERN),
        );
        const rescan = () => void this.scan(folder).then(() => this.emitter.fire());
        watcher.onDidChange(rescan);
        watcher.onDidCreate(rescan);
        watcher.onDidDelete(rescan);
        this.watchers.push(watcher);
      }
    }
    this.emitter.fire();
  }

  private async read(folder: vscode.WorkspaceFolder, name: string): Promise<string | undefined> {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, name));
      return new TextDecoder().decode(bytes);
    } catch {
      return undefined;
    }
  }

  private async scan(folder: vscode.WorkspaceFolder): Promise<void> {
    const groups: DiscoveredGroup[] = [];
    let rootFiles: string[] = [];
    try {
      rootFiles = (await vscode.workspace.fs.readDirectory(folder.uri)).map(([name]) => name);
    } catch {
      rootFiles = [];
    }

    const packageJson = await this.read(folder, 'package.json');
    if (packageJson !== undefined) {
      const manager = detectPackageManager(rootFiles);
      const tasks = parsePackageScripts(packageJson, manager);
      if (tasks.length > 0) groups.push({ source: 'npm', label: `${manager} scripts`, tasks });
    }

    for (const name of MAKEFILES) {
      if (!rootFiles.includes(name)) continue;
      const text = await this.read(folder, name);
      if (text === undefined) continue;
      const tasks = parseMakefileTargets(text);
      if (tasks.length > 0) groups.push({ source: 'make', label: `${name} targets`, tasks });
      break;
    }

    for (const name of JUSTFILES) {
      if (!rootFiles.includes(name)) continue;
      const text = await this.read(folder, name);
      if (text === undefined) continue;
      const tasks = parseJustfileRecipes(text);
      if (tasks.length > 0) groups.push({ source: 'just', label: `${name} recipes`, tasks });
      break;
    }

    this.cache.set(folder.uri.toString(), groups);
    log().debug(`Discovered ${groups.length} task group(s) in ${folder.name}`);
  }
}
