import * as vscode from 'vscode';
import type { ContextService } from './context/contextService';
import { scoreRelevance } from '@snip-pick/core';
import type { Store } from './store/store';

/** Offers snippets that define a `prefix` as ordinary IntelliSense completions. */
export function registerCompletions(
  store: Store,
  contextService: ContextService,
): vscode.Disposable {
  const provider: vscode.CompletionItemProvider = {
    provideCompletionItems(document) {
      const configuration = vscode.workspace.getConfiguration('snipPick');
      if (!configuration.get<boolean>('completions.enabled', true)) return undefined;

      const active = { ...contextService.context(), languageId: document.languageId };
      const completions: vscode.CompletionItem[] = [];
      for (const { item } of store.allItems()) {
        if (item.type !== 'snippet' || !item.prefix) continue;
        if (!scoreRelevance(item.context, active).relevant) continue;
        const completion = new vscode.CompletionItem(
          item.prefix,
          vscode.CompletionItemKind.Snippet,
        );
        completion.insertText = new vscode.SnippetString(item.body);
        completion.detail = `Snip Pick · ${item.title}`;
        completion.documentation = new vscode.MarkdownString().appendCodeblock(
          item.body,
          item.context?.languages?.[0] ?? document.languageId,
        );
        if (item.description) completion.detail = `Snip Pick · ${item.description}`;
        completion.sortText = item.pinned ? `0${item.prefix}` : `1${item.prefix}`;
        completions.push(completion);
      }
      return completions;
    },
  };

  return vscode.languages.registerCompletionItemProvider({ scheme: '*', pattern: '**' }, provider);
}
