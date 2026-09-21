# Snip Pick

Snippets and shell commands where you need them: in the editor, and — optionally — shared with
your team.

## Layout

Each package owns one area, and the edges point one way — the graph below is acyclic and every
package declares exactly what it imports. Four packages depend on nothing at all.

```
apps/extension  ──►  contracts, core, api-client
apps/api        ──►  contracts, config, db, auth, auth-verify
tools/db        ──►  config, db, auth

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
| [`tools/db`](tools/db)                         | The local Postgres container and the commands that drive it. Development only; nothing ships.                                                     |

Two rules keep that shape, and both are enforced rather than documented:

- **Packages export factories, not singletons.** `createDb(config)`, `createAuth({db, config})`.
  Importing a package never reads the environment or opens a socket, so a unit test, a migration
  script and drizzle-kit can all reach it. Apps are composition roots and may hold the singleton.
- **Server code and extension code cannot mix.** `.oxlintrc.json` rejects the import in either
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

### Running the extension in VS Code

Open the **repository root**, not `apps/extension`. `.vscode/launch.json` and `.vscode/tasks.json`
live here, and every path in them is relative to the root folder.

Press <kbd>F5</kbd>, or pick **Run Extension** in the Run and Debug view. That runs the
`npm: watch` task in `apps/extension` first — esbuild in watch mode, writing `dist/extension.js` —
and then opens a second window, the **Extension Development Host**, launched with
`--extensionDevelopmentPath=apps/extension`. That window runs your working copy, not anything
installed from a marketplace.

The host starts on whatever folder it had open last, and the workspace library is
`.vscode/snippick.json` inside the open folder — so open one before testing that half.
`apps/extension/test/fixtures/workspace` is the folder the integration tests use and does fine.
Then: the **Snip Pick** view in the activity bar, <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> /
<kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>S</kbd> for the quick pick, and everything else under
**Snip Pick:** in the command palette.

**The edit loop.** esbuild rebuilds on save, but the host does not pick the new bundle up by
itself — reload it with <kbd>Cmd</kbd>+<kbd>R</kbd> / <kbd>Ctrl</kbd>+<kbd>R</kbd>, or
**Developer: Reload Window** from the host's own command palette. A reload covers changes to
`src/` and to the workspace packages, which are bundled from TypeScript source. A change to
`apps/extension/package.json` — a new command, menu entry or setting — needs the host **restarted**
instead, because contributions are read once when the extension is loaded.

**Debugging.** Breakpoints in `src/**/*.ts` work as they are: the watch build emits sourcemaps and
`outFiles` points at `dist`. `console.log` output and uncaught errors from the extension go to the
**Debug Console of the first window**, not of the host. For webview problems, use
**Help → Toggle Developer Tools** inside the host.

**Your real snippets.** The user library lives in the extension's global storage, which is keyed by
extension id and user-data directory — so if you also have Snip Pick installed normally, the host
reads and writes the same file. To keep development away from it, add
`"--user-data-dir=/tmp/snip-pick-dev"` to the `args` of the **Run Extension** configuration; the
host then starts as a clean instance with its own settings, its own extensions and its own user
library.

**Integration tests in the debugger.** Run and Debug → **Extension Tests** compiles the suite
(`compile:tests`) and launches a host on `apps/extension/test/fixtures/workspace` that runs
`out/test/integration/index`. Breakpoints work in the test files too. The headless equivalent is
`pnpm run test:integration`, which downloads a stable VS Code on first run. Unit tests need no
editor at all: `pnpm run test:unit`, or `pnpm vitest` to watch.

When something does not start:

| Symptom                                               | Cause                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The `npm: watch` preLaunchTask fails                  | VS Code's npm task provider picks the package manager from the lockfile; if it reaches for npm anyway, set `"npm.packageManager": "pnpm"` in your settings.                                                                                                                                                                      |
| The host opens but nothing has changed                | The bundle was not rebuilt, or the host was not reloaded. Check the watch task's terminal.                                                                                                                                                                                                                                       |
| `Server code reached the extension bundle`            | An import pulled a server-only package into the graph. Nothing is written when that happens, so the host keeps running the previous bundle until it is fixed.                                                                                                                                                                    |
| The host window opens and closes a second later       | The extension host could not start its inspector, almost always because the previous debug session left a helper holding the port. `lsof -nP -iTCP:5870 -sTCP:LISTEN` shows it; quitting VS Code entirely (not just closing the window) releases it. VS Code's own log records this as `Extension host ... exited with code: 6`. |
| The watch task keeps running after you stop debugging | It is a background task, by design. **Terminal → Terminate Task** ends it.                                                                                                                                                                                                                                                       |

More on the extension itself: [apps/extension/README.md](apps/extension/README.md).

### Running the API locally

The API needs a Postgres. [tools/db](tools/db) is one container and the commands that drive it;
it wants Docker Desktop running and nothing else.

```sh
pnpm run db:reset                        # container on :55432, migrated and seeded
cp apps/api/.env.example apps/api/.env   # once
pnpm --filter @snip-pick/api dev
```

`db:reset` deletes the volume and builds the database from nothing, which is the one to reach for
when a migration or a half-finished experiment has left it somewhere you no longer recognise. The
steps are separate too: `db:up` and `db:down` start and stop the container without touching the
data, `db:migrate` applies `packages/db/drizzle`, and `db:seed` creates the development tenant —
**dev@example.com** / **correct-horse-battery-staple** in _Acme Corp_ — along with the OAuth
client the extension authenticates as. Seeding is idempotent, so it is safe on a database that
already has them.

Point `snipPick.remote.url` at `http://localhost:8787`, run **Snip Pick: Sign In to a Server…**
and sign in as that user, and the tenant's vaults appear in the tree.

The two halves treat configuration differently, on purpose. The database tooling falls back to
the values in `apps/api/.env.example`, so `db:reset` works on a fresh clone with nothing set up —
see [tools/db/README.md](tools/db/README.md). The API does not: `loadServerConfig` throws on the
first missing variable rather than inventing one, because a server that guesses its own signing
secret or issuer is a server that fails much later and much worse. Hence the copy above. Its
scripts read `apps/api/.env` if it is there, and a real environment variable beats the file, so
a deployment sets variables and ships no `.env` at all.

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
