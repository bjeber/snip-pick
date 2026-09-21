# @snip-pick/api

Self-hostable, multi-tenant storage for Snip Pick vaults. Optional — the extension works entirely
offline without it.

The API is **its own OAuth 2.1 authorization server**, so a company runs it at an internal URL and
the editor talks to it directly. No third-party identity provider is required, and no long-lived
secret is ever pasted into a settings file.

## Running it

```sh
pnpm run db:up                       # from the repo root: Postgres on :55432
cp .env.example .env                # then edit BETTER_AUTH_SECRET
pnpm --filter @snip-pick/api db:migrate
pnpm --filter @snip-pick/api dev
```

`GET /health` confirms it is up and prints the issuer and resource identifier it derived.

## Shape

| Concept        | Backed by                                                                                                        |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tenant         | a better-auth **organization**                                                                                   |
| Project        | a better-auth **team**, so membership and invitations are the ones the organization already manages              |
| Project vault  | a `vault` row with `team_id` set — visible to the members of that team                                           |
| Personal vault | a `vault` row with `owner_user_id` set — one per member per tenant, so two employers never bleed into each other |

Both kinds are created lazily the first time a member lists their vaults, so adding the feature to
an existing tenant needs no backfill.

`vault.revision` is a per-vault counter for the delta sync that follows: clients will pull
`?since=<revision>` and write with the `version` they edited from. Nothing uses it yet.

## Endpoints

| Route                                     | What it does                                                                                         |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/.well-known/oauth-authorization-server` | RFC 8414 metadata, served at the origin root so a client can discover a deployment from just its URL |
| `/.well-known/oauth-protected-resource`   | RFC 9728 — points clients at the authorization server guarding `/v1`                                 |
| `/api/auth/*`                             | better-auth: sessions, organizations, and the whole OAuth surface                                    |
| `/sign-in`, `/consent`                    | the two browser pages the flow needs, server-rendered, no frontend build                             |
| `GET /v1/me`                              | who the access token belongs to                                                                      |
| `GET /v1/vaults`                          | every vault the caller can reach, across every tenant                                                |

`/v1/*` requires a bearer access token. Tokens are verified locally against the JWT plugin's key
set — not over HTTP against our own `/jwks`, because a container usually cannot reach its own
public URL. Issuer and audience are both checked, so a token minted by this server for a
_different_ resource cannot be replayed here (RFC 8707).

## The VS Code client

`seedVsCodeClient()` registers a well-known public client at boot:

- `client_id: snip-pick-vscode`, `token_endpoint_auth_method: "none"` — a desktop app cannot keep
  a secret, and declaring that is what makes the server **enforce PKCE** on it.
- `skip_consent` — it is first-party; a company's own extension does not ask its own users for
  consent.
- Redirect URIs come from `VSCODE_REDIRECT_URIS`, defaulting to the extension's `vscode://` URI
  plus `https://vscode.dev/redirect` for Remote SSH, Codespaces and vscode.dev, where
  `asExternalUri` tunnels through a web redirect.

Seeding it means no administrator has to hand-register a client before anyone can sign in, and
dynamic client registration can stay off (`ALLOW_DYNAMIC_CLIENT_REGISTRATION=false`) unless a
deployment actually wants third-party clients.

## Tests

`apps/api/test/oauth-flow.test.ts` drives a full authorization-code + PKCE exchange against a real
server and a real database: discovery, sign-up, tenant and team creation, code issuance, a
**rejected** exchange with the wrong verifier, audience-bound token claims, the vault listing, the
challenges for missing and malformed tokens, and a refresh.

It skips unless `DATABASE_URL` and `BETTER_AUTH_SECRET` are both set. The secret has to be the one
the database was populated with — better-auth encrypts the JWKS private key with it.

```sh
DATABASE_URL=... BETTER_AUTH_SECRET=... pnpm exec vitest run apps/api
```
