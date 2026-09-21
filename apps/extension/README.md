# Snip Pick – Snippets & Shell Commands

Collect the snippets and shell commands you actually use, group them, and reach them in two
keystrokes. Snip Pick knows which file you have open, so the things that matter here come first.

<!-- TODO(bieber): record media/demo.gif (Quick Pick → insert snippet → paste command) and it will render here. -->

![Snip Pick in action](media/demo.gif)

## Features

- **One Quick Pick for everything.** `Ctrl+Alt+S` (`Cmd+Alt+S` on macOS) lists every snippet and
  command, split into **Pinned**, **Relevant** and **Other**, with fuzzy matching on titles,
  descriptions, tags and bodies.
- **File-context aware.** Items can declare the languages, globs and marker files they belong to.
  Matching items float to the top; the rest can be dimmed or hidden entirely.
- **Frecency ordering.** What you use often, and recently, keeps moving up.
- **Sidebar library.** A tree with nested groups, drag-and-drop between groups and scopes, pin,
  duplicate, rename — the usual.
- **Snippets insert properly.** Full VS Code snippet syntax (`${1:name}`, `$0`, `${TM_FILENAME}`),
  inserted at the cursor. Snippets with a `prefix` also show up in IntelliSense.
- **Commands are pasted, not executed.** By default a command lands in a terminal without pressing
  Enter, so you get the last word. Destructive-looking commands ask first.
- **Variables.** `{{name}}`, `{{name:default}}`, `{{secret:TOKEN}}` and editor built-ins like
  `${relativeFile}`, resolved just before the command is sent.
- **Two scopes.** Global items follow you around; workspace items live in
  `.vscode/snippick.json` and can be committed with the project.
- **Auto-discovery.** `package.json` scripts, `Makefile` targets and `justfile` recipes show up
  read-only under **Discovered**, ready to run or to copy into your own library.
- **Plain JSON.** Human-readable, diffable, hand-editable — with schema-backed IntelliSense.

## Quick start

1. Install the extension and open the **Snip Pick** view in the activity bar.
2. Select some code, right-click → **Snip Pick: Add Snippet from Selection**. The language of the
   file is filled in for you as a context rule.
3. Run **Snip Pick: Add Command** and save something you retype a lot, e.g.
   `docker compose logs -f {{service}}`.
4. Press `Ctrl+Alt+S` / `Cmd+Alt+S`, type a few letters, hit Enter.

Nothing needs configuring. Context rules are optional; items without them are always shown.

### Moving the view to the secondary side bar

Snip Pick contributes its own container in the activity bar, on the left. If you would rather keep
it on the right, next to the editor:

1. Open the secondary side bar once: **View → Appearance → Secondary Side Bar**
   (`Ctrl+Alt+B` / `Cmd+Alt+B`).
2. Drag the **Snip Pick** icon from the activity bar and drop it into the secondary side bar.

VS Code remembers the position. (Extensions cannot place a view there themselves without a
proposed API that is not publishable, so this one drag is the supported route.)

## Where the data lives

| Scope     | File                                                                                                                         |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Global    | `<globalStorage>/snippick.json` — see **Help → Toggle Developer Tools → Application** or your platform's VS Code user folder |
| Workspace | `<workspace folder>/.vscode/snippick.json`, one per folder in a multi-root workspace                                         |

Files are created lazily on the first write, pretty-printed with two-space indentation and a stable
key order, and written atomically (temp file plus rename). External changes — a `git pull`, or your
own edits in the editor — are picked up automatically.

Usage statistics are deliberately **not** stored in these files, so committing
`.vscode/snippick.json` does not produce churn. They live in VS Code's own storage
(`globalState` for global items, `workspaceState` for workspace items) and ride along with
Settings Sync.

### File format

```jsonc
{
  "schemaVersion": 1,
  "groups": [{ "id": "…", "name": "Docker", "order": 0 }],
  "items": [
    {
      "id": "…",
      "type": "command",
      "title": "Tail service logs",
      "body": "docker compose logs -f {{service}}",
      "groupId": "…",
      "tags": ["docker"],
      "context": { "markers": ["compose.yaml"] },
      "cwd": "workspace",
      "createdAt": 1730000000000,
      "updatedAt": 1730000000000,
    },
  ],
}
```

`.vscode/snippick.json` is backed by a JSON schema, so hand-editing gets completion and validation.
If a file ever becomes invalid, Snip Pick says so, offers to open it, keeps serving the last good
state — and never overwrites it.

Use **Snip Pick: Export…** / **Snip Pick: Import…** to move a whole scope around (import asks
whether to merge or replace), and **Snip Pick: Import .code-snippets…** to pull in existing VS Code
snippet files. Any group can be exported back out as `.code-snippets`.

## Context rules

| Rule        | Matches                                                       | Score |
| ----------- | ------------------------------------------------------------- | ----- |
| `languages` | the active document's `languageId`                            | +3    |
| `globs`     | the active file's workspace-relative path (dotfiles included) | +4    |
| `markers`   | a file at the root of the active workspace folder             | +2    |

Scores add up. An item **without** context rules is neutral and always listed. An item **with**
rules that match nothing is "not relevant": it sinks to the bottom, or disappears when
**Relevant only** is toggled on in the view title bar.

Everything is ordered: pinned → relevance → frecency (usage count halving every 7 days) → title.

## Variables

Variables are resolved when a command runs, just before it reaches the terminal.

| Syntax               | Meaning                                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `{{name}}`           | Prompts with an input box. The last value you entered for this item is pre-filled.                          |
| `{{name:default}}`   | Same, pre-filled with `default` the first time. Colons inside the default are kept.                         |
| `{{secret:NAME}}`    | Read from VS Code's SecretStorage. If it is not there yet you are prompted (masked) and offered to save it. |
| `${file}`            | Absolute path of the active file                                                                            |
| `${relativeFile}`    | Path relative to the workspace folder                                                                       |
| `${fileBasename}`    | File name with extension                                                                                    |
| `${fileDirname}`     | Directory of the active file                                                                                |
| `${workspaceFolder}` | Absolute path of the active workspace folder                                                                |
| `${selectedText}`    | Current selection                                                                                           |
| `${lineNumber}`      | Cursor line, 1-based                                                                                        |

Write `\{{` or `\${` for a literal `{{` / `${`. Anything in `${…}` that is not one of the
built-ins above is left untouched, so shell variables like `${HOME}` survive.

Manage stored secrets with **Snip Pick: Set Secret…** and **Snip Pick: Clear Secrets…**. Secret
values are never written to a `snippick.json` file.

### Command chains

A command item can carry `steps` instead of a `body`. The steps are joined with `&&` and sent as
a single line, so `runBehavior: "paste"` still lets you read and edit the whole chain before
pressing Enter. `&&` needs a shell that understands it — bash, zsh, fish, cmd.exe and PowerShell 7+
all do; Windows PowerShell 5.1 does not, so use `;` in your steps there.

## Remote vaults (optional)

Snip Pick is local by default and stays that way unless you point it at a server. Nothing phones
home, and no account is needed to use any of the above.

If your team runs a [Snip Pick API](../api), set `snipPick.remote.url` to it — workspace settings
are a good place, so a project points at the company server automatically — then run
**Snip Pick: Sign In to a Server…**.

Signing in opens your browser, you authenticate against your own company's server, and it hands
the editor back a token. The flow is **OAuth 2.1 with PKCE** against a public client: there is no
API key to paste anywhere, and no long-lived secret in your settings. Tokens live in VS Code's
SecretStorage (your OS keychain) and refresh themselves; the account shows up in the **Accounts**
menu in the activity bar, alongside your other sign-ins, and several accounts can coexist if you
work with more than one company.

Once signed in, **Snip Pick: Select Vaults…** lists what you can reach:

- **your personal vault** in each tenant — private to you, one per tenant, so two employers never
  mix;
- **a project vault** for every team you belong to — shared with that team.

The ones you pick appear as extra roots in the tree, beside Global and your workspace folders.

> **Reading and writing remote vault contents is not implemented yet.** This release signs you in
> and shows which vaults you have; a mounted vault currently renders a placeholder instead of its
> items. Delta sync is the next piece of work.

If you use VS Code Insiders, Remote SSH, Codespaces or vscode.dev, the sign-in redirect comes back
through a different URI than on desktop stable. The server ships with all of them registered, so
it should just work — if it does not, your administrator can add the URI to
`VSCODE_REDIRECT_URIS`.

## Settings

| Setting                        | Default         | What it does                                                                                  |
| ------------------------------ | --------------- | --------------------------------------------------------------------------------------------- |
| `snipPick.showRelevantOnly`    | `false`         | Hide items whose context rules do not match the active file. Toggled from the view title bar. |
| `snipPick.clickAction`         | `"insertOrRun"` | What clicking an item in the tree does: `insertOrRun`, `edit` or `none`.                      |
| `snipPick.runBehavior`         | `"paste"`       | `paste` sends the command without Enter; `execute` runs it immediately.                       |
| `snipPick.confirmDangerous`    | `true`          | Show a modal with the resolved command when it looks destructive.                             |
| `snipPick.defaultScope`        | `"global"`      | Scope pre-selected when creating items.                                                       |
| `snipPick.discovery.enabled`   | `true`          | Show the read-only **Discovered** node.                                                       |
| `snipPick.completions.enabled` | `true`          | Offer snippets that have a `prefix` as IntelliSense items.                                    |

## Commands

All of these are in the Command Palette under **Snip Pick**: Open…, Add Snippet, Add Snippet from
Selection, Add Command, New Group, Toggle "Relevant Only", Refresh, Export…, Import…,
Import .code-snippets…, Set Secret…, Clear Secrets…. Item- and group-specific actions (Insert, Run,
Copy, Edit, Edit as JSON, Delete, Pin/Unpin, Duplicate, Move to Group…, Rename Group, Delete Group)
live on the tree's context menus, where they have something to act on.

## Security

- **Paste by default.** `snipPick.runBehavior` is `paste`: commands are typed into the terminal for
  you but not executed. Switch to `execute` only if you want the opposite.
- **Dangerous-command confirmation.** `rm -rf`, `--force`, `git push -f`, `DROP TABLE`, `mkfs`,
  `dd if=`, fork bombs, `chmod -R 777`, writes to `/dev/sd*` and `sudo` trigger a modal showing the
  fully resolved command. Any item can also set `"confirm": true` to always ask.
- **Workspace trust.** In an untrusted workspace, workspace items are read-only and no command can
  be run. Global items still work.
- **Virtual workspaces.** Without a local folder there is no terminal to send to, so commands are
  copied to the clipboard instead.
- **Secrets.** `{{secret:NAME}}` values go through VS Code's SecretStorage (the OS keychain). They
  are never written to `snippick.json`, never exported, and only the list of names is remembered.
- **Sign-in.** OAuth 2.1 with PKCE against a public client — no API keys, and nothing long-lived in
  settings. Access and refresh tokens are kept in SecretStorage, never in a file. The `state` and
  the RFC 9207 `iss` of every callback are checked before a code is exchanged.
- **Copying** an item puts its raw body on the clipboard — variables are _not_ resolved, so a
  secret cannot leak into the clipboard by accident.

## Development

```sh
npm install
npm run watch      # esbuild in watch mode
# press F5 in VS Code to launch an Extension Development Host
npm run lint
npm run test:unit
npm run test:coverage
npm run test:integration
npm run package    # produces a .vsix
```

`npm run icon` regenerates `media/icon.png` from `media/icon.svg`.

The pure logic — schema validation, merging, relevance, frecency, the variable parser, the danger
heuristics, the discovery parsers and the importers — lives in modules free of `vscode` imports, so
it can be unit-tested with Vitest. Everything that touches the API is covered by integration tests
running in a real VS Code instance.

## Contributing

This project doesn't accept outside pull requests, but issues and ideas are welcome.

## License

MIT — see [LICENSE](LICENSE).
