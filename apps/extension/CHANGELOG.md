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

### Note

- Reading and writing remote vault contents is not implemented yet: a mounted vault renders a
  placeholder. Delta sync is next.

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
