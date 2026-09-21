# Snip Pick

Snippets and shell commands where you need them: in the editor, and — optionally — shared with
your team.

| Package                                      | What it is                                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`apps/extension`](apps/extension)           | The VS Code extension. Works entirely offline against local JSON files; this is the whole product if you never run a server.                           |
| [`apps/api`](apps/api)                       | A self-hostable multi-tenant API (Hono + better-auth + Postgres) that stores shared vaults. Optional.                                                  |
| [`packages/core`](packages/core)             | The data model, relevance scoring, template parsing and importers. Free of `vscode` and of server-only dependencies, so both sides share one contract. |
| [`packages/api-client`](packages/api-client) | Typed API client and the OAuth 2.1 + PKCE flow. Platform-agnostic, so the token exchange is testable without an editor.                                |

## Getting started

```sh
npm install
npm run check          # lint, typecheck, unit tests, build — everything
```

Extension development: press <kbd>F5</kbd> (see [apps/extension/README.md](apps/extension/README.md)).

API development:

```sh
npm run db:up                       # Postgres on :55432
cp apps/api/.env.example apps/api/.env
npm run db:migrate -w apps/api
npm run dev -w apps/api
```

## How the pieces fit

The extension's default state is **local**: a global JSON file plus one per workspace folder,
committable alongside your project. Nothing phones home.

Signing in to an API adds **remote vaults** next to the local ones — a personal vault inside the
tenant, plus whichever project vaults you have access to. All of them appear as roots in the same
tree, so the local/remote distinction stays a detail of where the bytes live.

Authentication is OAuth 2.1 with PKCE against the API itself, which acts as the authorization
server. No API keys, no long-lived secrets pasted into settings.

## Contributing

This project doesn't accept outside pull requests, but issues and ideas are welcome.

## License

MIT — see [LICENSE](LICENSE).
