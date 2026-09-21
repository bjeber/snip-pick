import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { serverCodeIn } from '../apps/extension/esbuild.mjs';

/**
 * The server/extension split, asserted rather than assumed.
 *
 * .oxlintrc.json cannot share a constant between its override blocks the way eslint.config.mjs
 * did, and oxlint — like eslint — REPLACES a rule's options when a later block sets the same rule
 * rather than merging them. Both make it easy for a block to quietly stop banning something:
 * that exact bug shipped in the eslint version of this config and was invisible in review. So
 * rather than inspecting the config, this runs the real linter over a file dropped into each
 * source root and checks what comes back.
 */

/**
 * Every import the boundary is supposed to reject, including the deep subpaths.
 *
 * The subpaths are the point. oxlint matches a `group` gitignore-style, so `drizzle-orm/*` covers
 * `drizzle-orm/node-postgres` but not `drizzle-orm/node-postgres/migrator`, and no `node:` glob
 * covers `node:fs/promises`. An earlier version of this test probed only the bare specifiers and
 * passed while both holes were wide open.
 */
const BANS = [
  'vscode',
  'pg',
  'node:crypto',
  'node:fs/promises',
  '@snip-pick/db',
  'drizzle-orm/node-postgres/migrator',
  'better-auth/adapters/drizzle',
  'hono/cors',
] as const;
type Ban = (typeof BANS)[number];

/** A file importing one of everything the boundary cares about. */
const PROBE = [
  "import * as vscode from 'vscode';",
  "import pg from 'pg';",
  "import { randomUUID } from 'node:crypto';",
  "import { readFile } from 'node:fs/promises';",
  "import { createDb } from '@snip-pick/db';",
  "import { migrate } from 'drizzle-orm/node-postgres/migrator';",
  "import { drizzleAdapter } from 'better-auth/adapters/drizzle';",
  "import { cors } from 'hono/cors';",
  "import { SnipPickApiClient } from '@snip-pick/api-client';",
  'export const probe = [vscode, pg, randomUUID, readFile, createDb];',
  'export const more = [migrate, drizzleAdapter, cors, SnipPickApiClient];',
].join('\n');

/** Server packages and their subpaths, rejected everywhere the extension can reach. */
const SERVER: Ban[] = [
  'pg',
  '@snip-pick/db',
  'drizzle-orm/node-postgres/migrator',
  'better-auth/adapters/drizzle',
  'hono/cors',
];

/** Node built-ins, bare and subpath. */
const NODE: Ban[] = ['node:crypto', 'node:fs/promises'];

const EXPECTED: Record<string, Ban[]> = {
  // The extension is the one place the editor API is allowed, and the one place server code
  // would actually be shipped to a user.
  'apps/extension/src': SERVER,
  // Isomorphic: no editor, no server, no platform at all.
  'packages/contracts/src': ['vscode', ...SERVER, ...NODE],
  'packages/core/src': ['vscode', ...SERVER, ...NODE],
  // Talks to the server over HTTP; does not link against it. node: builtins are fine here.
  'packages/api-client/src': ['vscode', ...SERVER],
  // Server side: the only thing off-limits is the editor API.
  'packages/config/src': ['vscode'],
  'packages/db/src': ['vscode'],
  'packages/auth/src': ['vscode'],
  'packages/auth-verify/src': ['vscode'],
  'apps/api/src': ['vscode'],
  // Development tooling, run by a person at a terminal. Server side like the rest of this list.
  'tools/db/src': ['vscode'],
};

const root = process.cwd();
const probeDirs = Object.keys(EXPECTED).map((source) => join(root, source, '__boundary__'));

afterAll(() => {
  for (const dir of probeDirs) rmSync(dir, { recursive: true, force: true });
});

function bansReportedIn(sourceRoot: string): Ban[] {
  const dir = join(root, sourceRoot, '__boundary__');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'probe.ts');
  writeFileSync(file, PROBE);
  let output: string;
  try {
    output = execFileSync(join(root, 'node_modules/.bin/oxlint'), [file], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    // oxlint exits non-zero whenever it reports anything, which is the point here.
    output = String((error as { stdout?: string }).stdout ?? '');
  }
  return BANS.filter((ban) => output.includes(`'${ban}' import is restricted`));
}

describe('oxlint rejects the import', () => {
  for (const [sourceRoot, expected] of Object.entries(EXPECTED)) {
    it(`${sourceRoot} rejects ${expected.join(', ')}`, () => {
      expect([...bansReportedIn(sourceRoot)].sort()).toEqual([...expected].sort());
    });
  }
});

describe('esbuild rejects the artifact', () => {
  /**
   * The other half of the boundary: the lint rule reads import statements, this reads the module
   * graph esbuild actually walked, so it still fires on a server package pulled in transitively
   * or past a disable comment.
   */
  it('spots server code anywhere in the module graph', () => {
    expect(
      serverCodeIn([
        'src/extension.ts',
        '../../packages/core/src/index.ts',
        '../../node_modules/minimatch/dist/esm/index.js',
      ]),
    ).toEqual([]);

    expect(serverCodeIn(['../../packages/db/src/client.ts'])).toHaveLength(1);
    expect(serverCodeIn(['../../packages/auth/src/auth.ts'])).toHaveLength(1);
    expect(serverCodeIn(['../../packages/auth-verify/src/jwks.ts'])).toHaveLength(1);
    expect(serverCodeIn(['../../packages/config/src/server.ts'])).toHaveLength(1);
    expect(serverCodeIn(['../../apps/api/src/server.ts'])).toHaveLength(1);
    expect(serverCodeIn(['../../node_modules/pg/lib/index.js'])).toHaveLength(1);
    expect(serverCodeIn(['../../node_modules/pg-pool/index.js'])).toHaveLength(1);
    expect(serverCodeIn(['../../node_modules/drizzle-orm/node-postgres/driver.js'])).toHaveLength(
      1,
    );
    expect(serverCodeIn(['../../node_modules/better-auth/dist/index.js'])).toHaveLength(1);
    expect(serverCodeIn(['../../node_modules/hono/dist/index.js'])).toHaveLength(1);
  });

  /**
   * pnpm resolves through its content-addressed store, so the paths esbuild reports are nested
   * and carry the peer-dependency hash. Detection keys off the inner `node_modules/<name>/`,
   * which is the one segment that stays clean.
   */
  it('sees through pnpm store paths', () => {
    expect(
      serverCodeIn([
        '../../node_modules/.pnpm/drizzle-orm@0.45.2_@types+pg@8.23.1_kysely@0.29.6_pg@8.23.0/node_modules/drizzle-orm/entity.js',
      ]),
    ).toHaveLength(1);
    expect(
      serverCodeIn(['../../node_modules/.pnpm/pg@8.23.0/node_modules/pg/lib/index.js']),
    ).toHaveLength(1);
    // A store directory names its own peers, so the hash must not be what decides this.
    expect(
      serverCodeIn([
        '../../node_modules/.pnpm/vitest@2.1.9_@types+node@20.19.43/node_modules/vitest/index.js',
      ]),
    ).toEqual([]);
  });

  /** packages/contracts and packages/core are the two that legitimately do reach the bundle. */
  it('does not mistake the isomorphic packages for server code', () => {
    expect(
      serverCodeIn([
        '../../packages/contracts/src/types.ts',
        '../../packages/core/src/context/relevance.ts',
        '../../packages/api-client/src/client.ts',
      ]),
    ).toEqual([]);
  });
});
