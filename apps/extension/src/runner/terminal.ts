import * as path from 'node:path';
import * as vscode from 'vscode';
import { log } from '../log';
import type { Cwd } from '@snip-pick/contracts';

const BASE_NAME = 'Snip Pick';

export interface TerminalTarget {
  cwd: vscode.Uri | undefined;
  name: string;
}

/** Works out where a command should run, given its `cwd` preference and the active editor. */
export function terminalTarget(
  cwd: Cwd | undefined,
  folder: vscode.WorkspaceFolder | undefined,
  activeFile: vscode.Uri | undefined,
): TerminalTarget {
  if (cwd === 'fileDir' && activeFile) {
    const directory = vscode.Uri.joinPath(activeFile, '..');
    if (!folder || directory.toString() !== folder.uri.toString()) {
      return { cwd: directory, name: `${BASE_NAME}: ${path.basename(directory.fsPath)}` };
    }
  }
  return { cwd: folder?.uri, name: BASE_NAME };
}

/** Owns the reusable "Snip Pick" terminals. */
export class TerminalRunner implements vscode.Disposable {
  private readonly terminals = new Map<string, vscode.Terminal>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.window.onDidCloseTerminal((closed) => {
        for (const [key, terminal] of this.terminals) {
          if (terminal === closed) this.terminals.delete(key);
        }
      }),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private terminalFor(target: TerminalTarget): vscode.Terminal {
    const key = target.cwd?.toString() ?? '';
    const existing = this.terminals.get(key);
    if (existing && existing.exitStatus === undefined) return existing;
    const options: vscode.TerminalOptions = {
      name: target.name,
      iconPath: new vscode.ThemeIcon('symbol-snippet'),
    };
    if (target.cwd) options.cwd = target.cwd;
    const terminal = vscode.window.createTerminal(options);
    this.terminals.set(key, terminal);
    return terminal;
  }

  /** Sends text to the matching terminal. `execute` presses Enter for the user. */
  send(command: string, target: TerminalTarget, execute: boolean): void {
    const terminal = this.terminalFor(target);
    terminal.show(true);
    terminal.sendText(command, execute);
    log().info(`${execute ? 'Executed' : 'Pasted'} command in "${target.name}"`);
  }
}
