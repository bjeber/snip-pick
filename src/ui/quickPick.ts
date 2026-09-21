import * as vscode from 'vscode';
import type { ContextService } from '../context/contextService';
import { rankItems } from '../context/ordering';
import { groupPath } from '../model/normalize';
import { bodyPreview, type Item } from '../model/types';
import type { Store } from '../store/store';
import type { UsageStore } from '../store/usageStore';

const COPY_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('copy'),
  tooltip: 'Copy to clipboard',
};
const EDIT_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('edit'),
  tooltip: 'Edit',
};
const PIN_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('pin'),
  tooltip: 'Pin / unpin',
};

interface Entry extends vscode.QuickPickItem {
  scopeId?: string;
  itemId?: string;
  create?: string;
}

export interface QuickPickActions {
  activate: (scopeId: string, itemId: string) => Promise<void>;
  copy: (scopeId: string, itemId: string) => Promise<void>;
  edit: (scopeId: string, itemId: string) => Promise<void>;
  togglePin: (scopeId: string, itemId: string) => Promise<void>;
  createCommand: (body: string) => Promise<void>;
}

export interface QuickPickDeps {
  store: Store;
  usage: UsageStore;
  contextService: ContextService;
  actions: QuickPickActions;
}

function entryFor(store: Store, scopeId: string, item: Item, readonly: boolean): Entry {
  const scope = store.scope(scopeId);
  const path = groupPath(store.groups(scopeId), item.groupId);
  const where = [path, scope?.kind === 'global' ? 'Global' : (scope?.label ?? 'Workspace')]
    .filter((part) => part.length > 0)
    .join(' · ');
  const buttons = readonly ? [COPY_BUTTON] : [COPY_BUTTON, EDIT_BUTTON, PIN_BUTTON];
  return {
    label: `$(${item.type === 'snippet' ? 'symbol-snippet' : 'terminal'}) ${item.title}`,
    description: [item.description, where, ...item.tags.map((tag) => `#${tag}`)]
      .filter((part) => part && part.length > 0)
      .join(' · '),
    detail: bodyPreview(item),
    buttons,
    scopeId,
    itemId: item.id,
  };
}

/** The keyboard-first entry point: every item from every scope, in three sections. */
export function openQuickPick(deps: QuickPickDeps): void {
  const { store, usage, contextService, actions } = deps;
  const picker = vscode.window.createQuickPick<Entry>();
  picker.title = 'Snip Pick';
  picker.placeholder = 'Search snippets and commands…';
  picker.matchOnDescription = true;
  picker.matchOnDetail = true;

  const relevantOnly = vscode.workspace
    .getConfiguration('snipPick')
    .get<boolean>('showRelevantOnly', false);

  const ranked = rankItems(
    store.allItems().map(({ scopeId, item }) => ({ ...item, __scopeId: scopeId })),
    { active: contextService.context(), usage: usage.all(), relevantOnly },
  );

  const pinned: Entry[] = [];
  const relevant: Entry[] = [];
  const other: Entry[] = [];
  for (const { item, relevance } of ranked) {
    const scopeId = (item as Item & { __scopeId: string }).__scopeId;
    const readonly = store.scope(scopeId)?.readonly === true;
    const entry = entryFor(store, scopeId, item, readonly);
    if (item.pinned) pinned.push(entry);
    else if (relevance.score > 0) relevant.push(entry);
    else other.push(entry);
  }

  const separator = (label: string): Entry => ({
    label,
    kind: vscode.QuickPickItemKind.Separator,
  });

  const baseItems: Entry[] = [];
  if (pinned.length > 0) baseItems.push(separator('Pinned'), ...pinned);
  if (relevant.length > 0) baseItems.push(separator('Relevant'), ...relevant);
  if (other.length > 0) baseItems.push(separator('Other'), ...other);

  const render = (value: string) => {
    const typed = value.trim();
    picker.items =
      typed.length > 0
        ? [
            ...baseItems,
            separator(''),
            {
              label: `$(add) Save "${typed}" as new command`,
              alwaysShow: true,
              create: typed,
            },
          ]
        : baseItems;
  };
  render('');

  const disposables: vscode.Disposable[] = [
    picker,
    picker.onDidChangeValue(render),
    picker.onDidTriggerItemButton(async ({ item, button }) => {
      if (!item.scopeId || !item.itemId) return;
      if (button === COPY_BUTTON) await actions.copy(item.scopeId, item.itemId);
      else if (button === EDIT_BUTTON) {
        picker.hide();
        await actions.edit(item.scopeId, item.itemId);
      } else if (button === PIN_BUTTON) {
        await actions.togglePin(item.scopeId, item.itemId);
      }
    }),
    picker.onDidAccept(async () => {
      const selected = picker.selectedItems[0];
      if (!selected) return;
      picker.hide();
      if (selected.create !== undefined) await actions.createCommand(selected.create);
      else if (selected.scopeId && selected.itemId) {
        await actions.activate(selected.scopeId, selected.itemId);
      }
    }),
    picker.onDidHide(() => vscode.Disposable.from(...disposables).dispose()),
  ];

  picker.show();
}
