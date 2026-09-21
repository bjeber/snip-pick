import type * as vscode from 'vscode';
import type { Item } from '@snip-pick/core';

export interface GroupOption {
  id: string;
  label: string;
}

function nonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i += 1) {
    text += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return text;
}

/** Safe to embed inside a `<script>` block. */
function toJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const STYLES = `
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    margin: 0;
    padding: 1rem 1.25rem 2rem;
  }
  form { display: grid; gap: 0.9rem; max-width: 46rem; }
  .row { display: grid; gap: 0.3rem; }
  .row-inline { display: flex; gap: 1rem; flex-wrap: wrap; align-items: center; }
  .grow-sm { flex: 1 1 12rem; }
  .grow-md { flex: 1 1 16rem; }
  .checkbox { width: auto; }
  .plain { font-weight: 400; }
  label { font-weight: 600; }
  .hint { color: var(--vscode-descriptionForeground); font-weight: 400; font-size: 0.9em; }
  input[type='text'], select, textarea {
    width: 100%;
    color: var(--vscode-input-foreground);
    background: var(--vscode-input-background);
    border: 1px solid var(--vscode-input-border, transparent);
    border-radius: 2px;
    padding: 0.4rem 0.5rem;
    font-family: inherit;
    font-size: inherit;
  }
  textarea {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    min-height: 9rem;
    resize: vertical;
    white-space: pre;
  }
  textarea.small { min-height: 5rem; }
  input:focus, select:focus, textarea:focus {
    outline: 1px solid var(--vscode-focusBorder);
    outline-offset: -1px;
  }
  fieldset {
    border: 1px solid var(--vscode-panel-border, var(--vscode-input-border, #8884));
    border-radius: 4px;
    padding: 0.75rem 1rem 1rem;
    display: grid;
    gap: 0.75rem;
  }
  legend { font-weight: 600; padding: 0 0.35rem; }
  .actions { display: flex; gap: 0.6rem; margin-top: 0.4rem; }
  button {
    color: var(--vscode-button-foreground);
    background: var(--vscode-button-background);
    border: none;
    border-radius: 2px;
    padding: 0.45rem 1rem;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary {
    color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground);
  }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  [hidden] { display: none !important; }
`;

const SCRIPT = `
  const vscodeApi = acquireVsCodeApi();
  const form = document.getElementById('form');
  const typeField = document.getElementById('type');
  const commandOnly = Array.from(document.querySelectorAll('[data-when="command"]'));
  const snippetOnly = Array.from(document.querySelectorAll('[data-when="snippet"]'));

  function syncType() {
    const isCommand = typeField.value === 'command';
    commandOnly.forEach((node) => { node.hidden = !isCommand; });
    snippetOnly.forEach((node) => { node.hidden = isCommand; });
  }
  typeField.addEventListener('change', syncType);
  syncType();

  function value(id) {
    const node = document.getElementById(id);
    return node.type === 'checkbox' ? node.checked : node.value;
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    vscodeApi.postMessage({
      type: 'save',
      payload: {
        title: value('title'),
        type: value('type'),
        body: value('body'),
        description: value('description'),
        prefix: value('prefix'),
        tags: value('tags'),
        groupId: value('groupId'),
        languages: value('languages'),
        globs: value('globs'),
        markers: value('markers'),
        cwd: value('cwd'),
        confirm: value('confirm'),
        steps: value('steps'),
      },
    });
  });

  document.getElementById('cancel').addEventListener('click', () => {
    vscodeApi.postMessage({ type: 'cancel' });
  });

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  document.getElementById('title').focus();
`;

/** Renders the edit form. No external resources; everything is inline behind a nonce-based CSP. */
export function renderEditorHtml(
  webview: vscode.Webview,
  item: Item,
  groups: readonly GroupOption[],
): string {
  const id = nonce();
  const csp = [
    "default-src 'none'",
    `style-src 'nonce-${id}'`,
    `script-src 'nonce-${id}'`,
    `img-src ${webview.cspSource}`,
  ].join('; ');

  const data = {
    item: {
      title: item.title,
      type: item.type,
      body: item.body,
      description: item.description ?? '',
      prefix: item.prefix ?? '',
      tags: item.tags.join(', '),
      groupId: item.groupId ?? '',
      languages: (item.context?.languages ?? []).join(', '),
      globs: (item.context?.globs ?? []).join(', '),
      markers: (item.context?.markers ?? []).join(', '),
      cwd: item.cwd ?? 'workspace',
      confirm: item.confirm === true,
      steps: (item.steps ?? []).join('\n'),
    },
    groups: groups.map((group) => ({ id: group.id, label: group.label })),
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Snip Pick</title>
<style nonce="${id}">${STYLES}</style>
</head>
<body>
<form id="form">
  <div class="row">
    <label for="title">Title</label>
    <input type="text" id="title" name="title" required />
  </div>

  <div class="row-inline">
    <div class="row grow-sm">
      <label for="type">Type</label>
      <select id="type" name="type">
        <option value="snippet">Snippet</option>
        <option value="command">Shell command</option>
      </select>
    </div>
    <div class="row grow-md">
      <label for="groupId">Group</label>
      <select id="groupId" name="groupId"></select>
    </div>
  </div>

  <div class="row">
    <label for="body">Body <span class="hint" data-when="snippet">VS Code snippet syntax works: \${1:name}, $0, \${TM_FILENAME}</span><span class="hint" data-when="command">Supports {{variable}}, {{name:default}}, {{secret:NAME}} and \${file}</span></label>
    <textarea id="body" name="body" spellcheck="false"></textarea>
  </div>

  <div class="row" data-when="command">
    <label for="steps">Command chain <span class="hint">One step per line. When set, the body is ignored.</span></label>
    <textarea id="steps" name="steps" class="small" spellcheck="false"></textarea>
  </div>

  <div class="row">
    <label for="description">Description</label>
    <input type="text" id="description" name="description" />
  </div>

  <div class="row-inline">
    <div class="row grow-md">
      <label for="tags">Tags <span class="hint">comma separated</span></label>
      <input type="text" id="tags" name="tags" />
    </div>
    <div class="row grow-sm" data-when="snippet">
      <label for="prefix">Prefix <span class="hint">IntelliSense trigger</span></label>
      <input type="text" id="prefix" name="prefix" />
    </div>
  </div>

  <fieldset>
    <legend>Context</legend>
    <div class="row">
      <label for="languages">Languages <span class="hint">languageIds, e.g. typescript, python</span></label>
      <input type="text" id="languages" name="languages" />
    </div>
    <div class="row">
      <label for="globs">Globs <span class="hint">e.g. **/*.test.ts</span></label>
      <input type="text" id="globs" name="globs" />
    </div>
    <div class="row">
      <label for="markers">Markers <span class="hint">files at the workspace root, e.g. package.json</span></label>
      <input type="text" id="markers" name="markers" />
    </div>
  </fieldset>

  <fieldset data-when="command">
    <legend>Command options</legend>
    <div class="row">
      <label for="cwd">Working directory</label>
      <select id="cwd" name="cwd">
        <option value="workspace">Workspace folder</option>
        <option value="fileDir">Directory of the active file</option>
      </select>
    </div>
    <div class="row-inline">
      <input type="checkbox" id="confirm" name="confirm" class="checkbox" />
      <label for="confirm" class="plain">Always ask before running</label>
    </div>
  </fieldset>

  <div class="actions">
    <button type="submit">Save</button>
    <button type="button" class="secondary" id="cancel">Cancel</button>
  </div>
</form>
<script nonce="${id}">
  const initial = ${toJson(data)};
  const groupSelect = document.getElementById('groupId');
  groupSelect.appendChild(new Option('(ungrouped)', ''));
  for (const group of initial.groups) {
    groupSelect.appendChild(new Option(group.label, group.id));
  }
  for (const [key, val] of Object.entries(initial.item)) {
    const node = document.getElementById(key);
    if (!node) continue;
    if (node.type === 'checkbox') node.checked = Boolean(val);
    else node.value = String(val);
  }
</script>
<script nonce="${id}">${SCRIPT}</script>
</body>
</html>`;
}
