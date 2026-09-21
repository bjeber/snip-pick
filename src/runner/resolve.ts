import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Item } from '../model/types';
import type { SecretsStore } from '../store/secrets';
import type { VariableHistory } from '../store/history';
import {
  collectPlaceholders,
  parseTemplate,
  renderTemplate,
  type BuiltinName,
  type TemplateValues,
} from './variables';

/** Computes the `${…}` built-ins from the active editor. */
export function builtinValues(
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor,
): Partial<Record<BuiltinName, string>> {
  const values: Partial<Record<BuiltinName, string>> = {};
  const folder = editor
    ? vscode.workspace.getWorkspaceFolder(editor.document.uri)
    : vscode.workspace.workspaceFolders?.[0];
  if (folder) values.workspaceFolder = folder.uri.fsPath;
  if (!editor) return values;
  const fsPath = editor.document.uri.fsPath;
  values.file = fsPath;
  values.relativeFile = vscode.workspace.asRelativePath(editor.document.uri, false);
  values.fileBasename = path.basename(fsPath);
  values.fileDirname = path.dirname(fsPath);
  values.selectedText = editor.document.getText(editor.selection);
  values.lineNumber = String(editor.selection.active.line + 1);
  return values;
}

export class TemplateResolver {
  constructor(
    private readonly secrets: SecretsStore,
    private readonly history: VariableHistory,
  ) {}

  /**
   * Substitutes built-ins, prompts for `{{variables}}` and reads `{{secret:NAME}}` values.
   * Returns `undefined` when the user cancels any prompt.
   */
  async resolve(item: Pick<Item, 'id' | 'title'>, template: string): Promise<string | undefined> {
    const nodes = parseTemplate(template);
    const placeholders = collectPlaceholders(nodes);
    const values: TemplateValues = { builtins: builtinValues(), prompts: {}, secrets: {} };

    const entered: Record<string, string> = {};
    for (const placeholder of placeholders.prompts) {
      const remembered = this.history.get(item.id, placeholder.name);
      const value = await vscode.window.showInputBox({
        title: item.title,
        prompt: `Value for {{${placeholder.name}}}`,
        value: remembered ?? placeholder.defaultValue ?? '',
        ignoreFocusOut: true,
      });
      if (value === undefined) return undefined;
      entered[placeholder.name] = value;
    }
    values.prompts = entered;
    if (Object.keys(entered).length > 0) await this.history.remember(item.id, entered);

    for (const name of placeholders.secrets) {
      const existing = await this.secrets.get(name);
      if (existing !== undefined) {
        values.secrets![name] = existing;
        continue;
      }
      const value = await vscode.window.showInputBox({
        title: item.title,
        prompt: `Secret "${name}" is not stored yet`,
        password: true,
        ignoreFocusOut: true,
      });
      if (value === undefined) return undefined;
      values.secrets![name] = value;
      const save = await vscode.window.showInformationMessage(
        `Save "${name}" in VS Code's secret storage?`,
        'Save',
        'Use Once',
      );
      if (save === 'Save') await this.secrets.set(name, value);
    }

    return renderTemplate(nodes, values);
  }
}
