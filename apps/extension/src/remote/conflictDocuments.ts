import * as vscode from 'vscode';
import { bodyPreview, type VaultConflict } from '@snip-pick/contracts';

const SCHEME = 'snippick-conflict';

/**
 * Backs the side-by-side view of a conflict.
 *
 * The two versions exist only in memory — neither is on disk, and writing them somewhere to open
 * them would mean cleaning temp files up after a window that may not close tidily. A content
 * provider serves them straight from the conflict record instead, and everything is dropped when
 * the vault stops being conflicted.
 */
export class ConflictDocuments implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly registration: vscode.Disposable;
  private counter = 0;

  constructor() {
    this.registration = vscode.workspace.registerTextDocumentContentProvider(SCHEME, this);
  }

  dispose(): void {
    this.registration.dispose();
    this.contents.clear();
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.path) ?? '';
  }

  /**
   * Opens the two versions next to each other.
   *
   * Theirs on the left and mine on the right, which is the order every diff in the editor uses
   * for "what is there" against "what I am proposing", so the green side is the one you would be
   * keeping by choosing mine.
   */
  async compare(conflict: VaultConflict, label: string): Promise<void> {
    this.counter += 1;
    const token = `${conflict.kind}-${conflict.id}-${this.counter}`;
    const theirs = this.put(`/${token}/theirs.json`, render(conflict.theirs));
    const mine = this.put(`/${token}/mine.json`, render(conflict.mine));
    await vscode.commands.executeCommand('vscode.diff', theirs, mine, `${label} — theirs ↔ mine`, {
      preview: true,
    } satisfies vscode.TextDocumentShowOptions);
  }

  private put(path: string, content: string): vscode.Uri {
    this.contents.set(path, content);
    return vscode.Uri.from({ scheme: SCHEME, path });
  }
}

/**
 * One side, as text.
 *
 * A deleted side is an empty document rather than a note saying so: the diff then shows the whole
 * of the other version as the difference, which is exactly what happened, and it stays valid JSON
 * so the editor colours both panes.
 */
function render(side: VaultConflict['mine']): string {
  if (side === null) return '';
  // Key order is stable so the diff shows what actually changed rather than a reshuffle.
  const ordered = Object.fromEntries(
    Object.entries(side)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** A one-line description of a side, for the picker that offers the choice. */
export function describeSide(side: VaultConflict['mine']): string {
  if (side === null) return 'deleted';
  if ('title' in side) return `"${side.title}" — ${bodyPreview(side, 48)}`;
  return `group "${side.name}"`;
}
