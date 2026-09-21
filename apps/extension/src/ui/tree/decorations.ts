import * as vscode from 'vscode';
import { parseItemResourceUri } from './nodes';
import type { ItemRef } from '../../store/store';

export interface ItemDecorationState {
  pinned: boolean;
  /** `true` when the item declares context rules that do not match the active file. */
  dimmed: boolean;
}

/**
 * Dims items that are not relevant to the active file and badges pinned ones. Kept separate from
 * the tree provider so both can be refreshed independently.
 */
export class ItemDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this.emitter.event;

  constructor(private readonly lookup: (ref: ItemRef) => ItemDecorationState | undefined) {}

  dispose(): void {
    this.emitter.dispose();
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const ref = parseItemResourceUri(uri);
    if (!ref) return undefined;
    const state = this.lookup(ref);
    if (!state) return undefined;
    const decoration: vscode.FileDecoration = {};
    if (state.pinned) {
      decoration.badge = '📌';
      decoration.tooltip = 'Pinned';
    }
    if (state.dimmed) {
      decoration.color = new vscode.ThemeColor('disabledForeground');
      decoration.tooltip = state.pinned
        ? 'Pinned · not relevant to the active file'
        : 'Not relevant to the active file';
    }
    return decoration.badge || decoration.color ? decoration : undefined;
  }
}
