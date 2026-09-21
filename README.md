# Snip Pick

Snippets and shell commands where you need them: in the editor, and — optionally — shared with
your team.

## Layout

Each package owns one area, and the edges point one way — the graph below is acyclic and every
package declares exactly what it imports. Four packages depend on nothing at all.

```
apps/extension  ──►  contracts, core, api-client
apps/api        ──►  contracts, config, db, auth, auth-verify

core            ──►  contracts
api-client      ──►  contracts
auth            ──►  config, db

contracts, config, db, auth-verify  ──►  nothing
```

| Package                                        | What it is                                                                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`apps/extension`](apps/extension)             | The VS Code extension. Works entirely offline against local JSON files; this is the whole product if you never run a server.                      |
| [`apps/api`](apps/api)                         | A self-hostable multi-tenant API that stores shared vaults. Composition and HTTP routing only — the pieces it wires together are below. Optional. |
| [`packages/contracts`](packages/contracts)     | Types and validation both ends of the wire must agree on. No runtime dependencies and no platform APIs at all.                                    |
| [`packages/core`](packages/core)               | Snippet behaviour for the editor: ranking, variables, danger detection, merging, discovery, import. Runs in a web extension host too.             |
| [`packages/api-client`](packages/api-client)   | Typed API client and the OAuth 2.1 + PKCE flow. Platform-agnostic, so the token exchange is testable without an editor.                           |
| [`packages/config`](packages/config)           | Server configuration, read from the environment and validated in one place.                                                                       |
| [`packages/db`](packages/db)                   | Postgres schema, drizzle client factory and migrations. Server-only.                                                                              |
| [`packages/auth`](packages/auth)               | The authorization server: better-auth, its OAuth 2.1 provider, first-party client seeding. Server-only.                                           |
| [`packages/auth-verify`](packages/auth-verify) | The resource-server half: verifies access tokens against a JWK set. No database, no better-auth.                                                  |

Two rules keep that shape, and both are enforced rather than documented:

- **Packages export factories, not singletons.** `createDb(config)`, `createAuth({db, config})`.
  Importing a package never reads the environment or opens a socket, so a unit test, a migration
  script and drizzle-kit can all reach it. Apps are composition roots and may hold the singleton.
- **Server code and extension code cannot mix.** `eslint.config.mjs` rejects the import in either
  direction; `apps/extension/esbuild.mjs` rejects the artifact, failing the build and writing
  nothing if a server module reaches the bundle through any path.

## Getting started

```sh
nvm use                 # Node 22, per .nvmrc — the version CI runs
corepack enable         # pnpm, at the version in package.json's packageManager field
pnpm install
pnpm run check          # lint, typecheck, unit tests, build — everything
```

Linting and formatting are [oxlint](https://oxc.rs) and oxfmt; `pnpm run format` writes.

Dependency versions live in one place. `pnpm-workspace.yaml` holds a
[catalog](https://pnpm.io/catalogs) of every external range, and each `package.json` refers to it
with `"drizzle-orm": "catalog:"` — so a bump is one line, and two packages cannot end up on
different versions of something they both load. `catalogMode: strict` keeps it honest both ways: `pnpm add`
puts a dependency the catalog does not have into it for you, and refuses a version that conflicts
with one it already has.

Extension development: press <kbd>F5</kbd> (see [apps/extension/README.md](apps/extension/README.md)).

API development:

```sh
pnpm run db:up                       # Postgres on :55432
cp apps/api/.env.example apps/api/.env
pnpm --filter @snip-pick/api db:migrate
pnpm --filter @snip-pick/api dev
```

## How the pieces fit

The extension's default state is **local**, at two levels: a **user** library that follows you
into every project on your machine, and a **workspace** library in the project's
`.vscode/snippick.json` that you commit so the whole team gets it on clone. Both are plain,
diffable JSON, and both show in the tree at once. Nothing phones home.

Signing in to an API adds **remote vaults** next to the local ones — a personal vault inside the
tenant, plus whichever project vaults you have access to. All of them appear as roots in the same
tree, so the local/remote distinction stays a detail of where the bytes live.

Authentication is OAuth 2.1 with PKCE against the API itself, which acts as the authorization
server. No API keys, no long-lived secrets pasted into settings.

## Contributing

This project doesn't accept outside pull requests, but issues and ideas are welcome.

## License

MIT — see [LICENSE](LICENSE).
