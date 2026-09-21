import * as vscode from 'vscode';
import type { ContextService } from '../context/contextService';
import { commandText, describeDanger, detectDangerous, type Item } from '@snip-pick/core';
import type { ItemRef, Store } from '../store/store';
import type { UsageStore } from '../store/usageStore';
import { insertSnippet } from './insert';
import type { TemplateResolver } from './resolve';
import { terminalTarget, type TerminalRunner } from './terminal';

/** A workspace with no local folders cannot host a terminal we can `cd` into meaningfully. */
export function isVirtualWorkspace(): boolean {
  const folders = vscode.workspace.workspaceFolders;
  return !!folders && folders.length > 0 && folders.every((folder) => folder.uri.scheme !== 'file');
}

/** Insert / run / copy, plus the confirmations and bookkeeping around them. */
export class ItemRunner {
  constructor(
    private readonly store: Store,
    private readonly usage: UsageStore,
    private readonly resolver: TemplateResolver,
    private readonly terminals: TerminalRunner,
    private readonly contextService: ContextService,
  ) {}

  /** The default action for an item: insert snippets, run commands. */
  async activate(ref: ItemRef): Promise<void> {
    const item = this.store.getItem(ref);
    if (!item) return;
    if (item.type === 'snippet') await this.insert(ref);
    else await this.run(ref);
  }

  async insert(ref: ItemRef): Promise<void> {
    const item = this.store.getItem(ref);
    if (!item) return;
    const inserted = await insertSnippet(item);
    if (inserted) await this.usage.record(ref.scopeId, ref.itemId);
  }

  async copy(ref: ItemRef): Promise<void> {
    const item = this.store.getItem(ref);
    if (!item) return;
    await vscode.env.clipboard.writeText(item.type === 'command' ? commandText(item) : item.body);
    void vscode.window.setStatusBarMessage(`Snip Pick: copied "${item.title}"`, 3000);
  }

  /** Runs a command that is not in the library (a discovered task). */
  async runAdHoc(
    title: string,
    command: string,
    folder: vscode.WorkspaceFolder | undefined,
  ): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        'Snip Pick cannot run commands in an untrusted workspace.',
      );
      return;
    }
    if (isVirtualWorkspace()) {
      await vscode.env.clipboard.writeText(command);
      void vscode.window.showInformationMessage(
        'Snip Pick cannot open a terminal in a virtual workspace. The command was copied instead.',
      );
      return;
    }
    const pseudoItem = { title, confirm: false } as Item;
    if (!(await confirmIfNeeded(pseudoItem, command))) return;
    this.terminals.send(
      command,
      terminalTarget('workspace', folder ?? this.contextService.activeFolder(), undefined),
      vscode.workspace.getConfiguration('snipPick').get<string>('runBehavior', 'paste') ===
        'execute',
    );
  }

  async run(ref: ItemRef): Promise<void> {
    const item = this.store.getItem(ref);
    if (!item) return;
    if (item.type !== 'command') {
      await this.insert(ref);
      return;
    }
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage(
        'Snip Pick cannot run commands in an untrusted workspace.',
      );
      return;
    }
    if (isVirtualWorkspace()) {
      void vscode.window.showWarningMessage(
        'Snip Pick cannot open a terminal in a virtual workspace. The command was copied instead.',
      );
      await this.copy(ref);
      return;
    }

    const resolved = await this.resolver.resolve(item, commandText(item));
    if (resolved === undefined) return;
    if (!(await confirmIfNeeded(item, resolved))) return;

    const editor = vscode.window.activeTextEditor;
    const target = terminalTarget(
      item.cwd,
      this.contextService.activeFolder(),
      editor?.document.uri,
    );
    const execute =
      vscode.workspace.getConfiguration('snipPick').get<string>('runBehavior', 'paste') ===
      'execute';
    this.terminals.send(resolved, target, execute);
    await this.usage.record(ref.scopeId, ref.itemId);
  }
}

/** Modal confirmation for commands marked `confirm` or flagged by the danger heuristics. */
export async function confirmIfNeeded(item: Item, resolved: string): Promise<boolean> {
  const confirmDangerous = vscode.workspace
    .getConfiguration('snipPick')
    .get<boolean>('confirmDangerous', true);
  const matches = confirmDangerous ? detectDangerous(resolved) : [];
  if (!item.confirm && matches.length === 0) return true;

  const detail =
    matches.length > 0
      ? `${resolved}\n\nFlagged because of:\n${describeDanger(matches)}`
      : resolved;
  const choice = await vscode.window.showWarningMessage(
    `Run "${item.title}"?`,
    { modal: true, detail },
    'Run',
  );
  return choice === 'Run';
}
