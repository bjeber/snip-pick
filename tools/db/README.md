# Local Postgres

The database the API develops against: one container, and the commands that drive it.

Nothing here ships. The API reads `DATABASE_URL` and does not care where Postgres came from —
this is simply the one that is easy to throw away.

## Requirements

Docker Desktop, running. `docker compose` is the CLI it installs; these scripts use nothing else.

## Commands

Run them from the repo root, where they are wrapped one for one:

| Command               | What it does                                                                        |
| --------------------- | ----------------------------------------------------------------------------------- |
| `pnpm run db:up`      | Starts the container and waits until Postgres answers, so the next command can run. |
| `pnpm run db:down`    | Stops it. The volume survives, so the data is still there next time.                |
| `pnpm run db:migrate` | Applies the migrations in `packages/db/drizzle`.                                    |
| `pnpm run db:seed`    | Creates the development tenant described below. Safe to run repeatedly.             |
| `pnpm run db:reset`   | **Deletes the volume**, then up, migrate and seed — a database from nothing.        |

From this folder the same five are `pnpm run up`, `down`, `migrate`, `seed` and `reset`, plus
`pnpm run psql` for a shell and `pnpm run logs` to follow the container's output.

## What the seed creates

- The first-party VS Code OAuth client, so the editor has something to authenticate as. (The
  running server seeds this too; doing it here means the database is complete before anything
  starts.)
- One user — **dev@example.com** / **correct-horse-battery-staple** — and one tenant, _Acme Corp_,
  with the default team better-auth gives it.

Fixed credentials, deliberately: the container is bound to loopback and holds nothing else. Point
`snipPick.remote.url` at `http://localhost:8787`, run **Snip Pick: Sign In to a Server…**, and
those are the details to type.

Vaults are not seeded. The API creates a member's personal vault and a team's project vault the
first time they are listed, so that adding either to an existing tenant needs no backfill —
writing them here would be a second copy of that rule, free to drift from the first.

## Configuration

The scripts need a connection string and, for seeding, better-auth's signing secret. Three
sources, weakest first:

1. The defaults in `src/config.ts`, which describe the container in this folder and match
   `apps/api/.env.example`.
2. `apps/api/.env`, if you have one.
3. The environment, which always wins.

So a fresh clone needs nothing set up, and a developer who has configured the API gets their own
values. That ordering matters most for `BETTER_AUTH_SECRET`: better-auth encrypts its JWKS
private key with it, and a database populated under one secret cannot sign tokens under another.
