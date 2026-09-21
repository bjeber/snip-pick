# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Optional remote vaults. Point `snipPick.remote.url` at a self-hosted Snip Pick API and sign in
  with OAuth 2.1 + PKCE — no API keys. Sessions appear in VS Code's Accounts menu, tokens live in
  SecretStorage and refresh themselves, and several accounts can coexist.
- **Snip Pick: Select Vaults…** lists your personal vault in each tenant plus a project vault for
  every team you belong to; the ones you pick become extra roots in the tree.
- Delta sync for remote vaults. A mounted vault is an ordinary library — same file format, same
  editing — kept in step with the server by pulling everything above a revision and pushing what
  the server has not seen. Both ends compare against the vault's revision counter rather than
  wall-clock timestamps, so two machines whose clocks disagree still order their writes correctly.
- **Snip Pick: Resolve Vault Conflicts…**, for when two people changed the same entry between
  syncs. That vault stops syncing and says so in the tree until you choose, per entry, which
  version to keep; nothing is sent or overwritten in the meantime. An edit on one side and a
  delete on the other counts as a conflict too — there is no version of that the extension could
  pick without throwing away somebody's work.
  **Compare…** opens the two versions side by side — theirs on the left, yours on the right, the
  way every other diff in the editor reads — and comes back to the same question afterwards,
  because looking is not deciding. A side that was deleted shows as an empty pane.
- `snipPick.allowCrossScopeDrag`, off by default, decides whether an item may be dragged from one
  scope to another.
- **Snip Pick: Set Server URL…** changes the configured server, or clears it by leaving the box
  empty. It sits in the view's overflow menu and on the "Sign in to load remote vaults" row, and
  a failed sign-in offers it directly. Before it, a server URL that turned out to be wrong could
  only be corrected by hand in settings.json: every path that needed one found the broken value
  already configured and never asked again.

### Changed

- The user-level library is labelled **User** rather than **Global**, matching VS Code's own
  vocabulary for the same split. `snipPick.defaultScope` now takes `user` (was `global`).
- Dragging an item from one scope to another is **refused** unless
  `snipPick.allowCrossScopeDrag` is turned on. The drop rewrites a different `snippick.json`, and
  it was too easy to trigger while reordering. Drags within a scope are unchanged, and
  **Export…** / **Import…** still move a whole scope deliberately.

### Changed (remote view)

- The remote row in the tree reads as an action rather than a third library: **Sign in**, with
  the server as `localhost:8787` instead of `http://localhost:8787`, and the whole URL plus what
  the gear does in the tooltip.
- Signing in mounted nothing and the row simply vanished, so the tree looked unchanged. That slot
  now holds **Select vaults**, the step that actually puts a vault on screen.

### Fixed

- Sign-in ended at the server's `invalid_redirect` page and never reached a browser. VS Code's
  `asExternalUri` appends a `windowId` to the callback on the desktop, and an authorization
  server matches `redirect_uri` against its registered list by exact string — so the URI the
  editor produced could not match anything a deployment had registered. The query is now dropped
  for a callback that is still on the editor's own scheme; the editor routes such a callback to
  this extension itself, and a flow is matched to its response by `state`, not by window. An
  https tunnel (Remote SSH, Codespaces, the web build) is still sent exactly as it came.


## [0.1.0] - 2026-09-21

### Added

- Library view with global and per-workspace-folder scopes, nested groups, drag-and-drop between
  groups and scopes, and pin / duplicate / rename / delete actions.
- Quick Pick (`Ctrl+Alt+S` / `Cmd+Alt+S`) with **Pinned**, **Relevant** and **Other** sections,
  fuzzy matching across title, description, tags and body, and per-item copy / edit / pin buttons.
- Snippet insertion with full VS Code snippet syntax, and clipboard fallback when no editor is open.
- Shell commands sent to a reusable "Snip Pick" terminal, pasted by default, honouring a
  `workspace` or `fileDir` working directory.
- Context awareness: `languages`, `globs` and `markers` rules, a relevance score, a
  "Relevant only" toggle and frecency-weighted ordering.
- Command variables `{{name}}`, `{{name:default}}` and `{{secret:NAME}}`, editor built-ins such as
  `${relativeFile}`, per-item value history and SecretStorage-backed secrets.
- Confirmation modal for commands that look destructive, and for items marked `confirm`.
- Webview edit form and "Edit as JSON" for every item.
- Auto-discovery of `package.json` scripts (npm/pnpm/yarn/bun), `Makefile` targets and `justfile`
  recipes, with "Copy to My Commands".
- Import and export of a whole scope, import of `.code-snippets` files and export of a group as
  `.code-snippets`.
- `CompletionItemProvider` offering snippets that define a `prefix`.
- JSON schema for `.vscode/snippick.json`.
- Workspace-trust handling: workspace items read-only and command execution disabled in untrusted
  workspaces.

[Unreleased]: https://github.com/bjeber/snip-pick/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bjeber/snip-pick/releases/tag/v0.1.0
