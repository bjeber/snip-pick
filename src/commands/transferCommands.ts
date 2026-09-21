import * as vscode from 'vscode';
import { newId } from '../model/ids';
import { descendantGroupIds } from '../model/normalize';
import { parseFile, serializeFile } from '../model/schema';
import { itemsToCodeSnippets, parseCodeSnippets, snippetsToItems } from '../importers/codeSnippets';
import type { MergeStrategy } from '../store/merge';
import { guard } from './itemCommands';
import { pickGroup, pickScope, toGroupRef } from './prompts';
import type { Services } from './services';

const JSON_FILTERS = { 'Snip Pick library': ['json'] };
const SNIPPET_FILTERS = { 'VS Code snippets': ['code-snippets', 'json'] };

export function registerTransferCommands(services: Services): vscode.Disposable[] {
  const { store } = services;

  return [
    vscode.commands.registerCommand('snipPick.export', async () => {
      const scope = await pickScope(store, 'Export — which scope?');
      if (!scope) return;
      const target = await vscode.window.showSaveDialog({
        title: 'Export Snip Pick library',
        filters: JSON_FILTERS,
        saveLabel: 'Export',
        defaultUri: vscode.Uri.file(`snippick-${scope.kind}.json`),
      });
      if (!target) return;
      await guard(async () => {
        const text = serializeFile(store.file(scope.id));
        await vscode.workspace.fs.writeFile(target, new TextEncoder().encode(text));
        void vscode.window.showInformationMessage(`Snip Pick: exported ${scope.label}.`);
      });
    }),

    vscode.commands.registerCommand('snipPick.import', async () => {
      const picked = await vscode.window.showOpenDialog({
        title: 'Import Snip Pick library',
        filters: JSON_FILTERS,
        canSelectMany: false,
        openLabel: 'Import',
      });
      const source = picked?.[0];
      if (!source) return;

      const bytes = await vscode.workspace.fs.readFile(source);
      const parsed = parseFile(new TextDecoder().decode(bytes));
      if (!parsed.ok) {
        void vscode.window.showErrorMessage(
          `Snip Pick: ${source.fsPath} is not a valid library (${parsed.errors[0]}).`,
        );
        return;
      }

      const scope = await pickScope(store, 'Import into which scope?', store.defaultScopeId());
      if (!scope) return;
      const strategy = await vscode.window.showQuickPick(
        [
          { label: 'Merge', description: 'Keep existing items, add new ones', value: 'merge' },
          { label: 'Replace', description: 'Discard everything in this scope', value: 'replace' },
        ],
        { title: `Import into ${scope.label}` },
      );
      if (!strategy) return;

      await guard(async () => {
        const result = await store.importFile(
          scope.id,
          parsed.file,
          strategy.value as MergeStrategy,
        );
        void vscode.window.showInformationMessage(
          `Snip Pick: ${result.addedItems} added, ${result.updatedItems} updated, ${result.skippedItems} unchanged.`,
        );
      });
    }),

    vscode.commands.registerCommand('snipPick.importCodeSnippets', async () => {
      const picked = await vscode.window.showOpenDialog({
        title: 'Import .code-snippets',
        filters: SNIPPET_FILTERS,
        canSelectMany: true,
        openLabel: 'Import',
      });
      if (!picked || picked.length === 0) return;

      const scope = await pickScope(store, 'Import into which scope?', store.defaultScopeId());
      if (!scope) return;
      const group = await pickGroup(store, scope.id, 'Import into which group?');
      if (!group) return;

      await guard(async () => {
        let imported = 0;
        const problems: string[] = [];
        for (const uri of picked) {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const { snippets, errors } = parseCodeSnippets(new TextDecoder().decode(bytes));
          problems.push(...errors);
          const items = snippetsToItems(snippets, {
            newId,
            ...(group.groupId !== undefined ? { groupId: group.groupId } : {}),
          });
          for (const item of items) {
            await store.addItem(scope.id, item);
            imported += 1;
          }
        }
        void vscode.window.showInformationMessage(
          problems.length > 0
            ? `Snip Pick: imported ${imported} snippet(s); skipped ${problems.length}.`
            : `Snip Pick: imported ${imported} snippet(s).`,
        );
      });
    }),

    vscode.commands.registerCommand('snipPick.exportCodeSnippets', async (arg: unknown) => {
      const ref = toGroupRef(arg);
      if (!ref) return;
      const group = store.getGroup(ref.scopeId, ref.groupId);
      if (!group) return;
      const groupIds = new Set([
        ref.groupId,
        ...descendantGroupIds(store.groups(ref.scopeId), ref.groupId),
      ]);
      const items = store
        .items(ref.scopeId)
        .filter((item) => item.type === 'snippet' && item.groupId && groupIds.has(item.groupId));
      if (items.length === 0) {
        void vscode.window.showInformationMessage('Snip Pick: this group has no snippets.');
        return;
      }
      const target = await vscode.window.showSaveDialog({
        title: 'Export group as .code-snippets',
        filters: SNIPPET_FILTERS,
        saveLabel: 'Export',
        defaultUri: vscode.Uri.file(
          `${group.name.replace(/\s+/g, '-').toLowerCase()}.code-snippets`,
        ),
      });
      if (!target) return;
      await guard(async () => {
        await vscode.workspace.fs.writeFile(
          target,
          new TextEncoder().encode(itemsToCodeSnippets(items)),
        );
        void vscode.window.showInformationMessage(
          `Snip Pick: exported ${items.length} snippet(s) from "${group.name}".`,
        );
      });
    }),
  ];
}
