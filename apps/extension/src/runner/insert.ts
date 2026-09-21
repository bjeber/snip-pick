import * as vscode from 'vscode';
import type { Item } from '@snip-pick/contracts';

/**
 * Inserts a snippet at the cursor (replacing the selection). With no editor open the body is put
 * on the clipboard instead, so the action is never a no-op.
 */
export async function insertSnippet(item: Item): Promise<boolean> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.env.clipboard.writeText(item.body);
    void vscode.window.showInformationMessage(
      `No editor is open — "${item.title}" was copied to the clipboard.`,
    );
    return true;
  }
  return editor.insertSnippet(new vscode.SnippetString(item.body));
}
