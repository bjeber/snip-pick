import { build, context } from 'esbuild';
import { readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const production = argv.includes('--production');
const watch = argv.includes('--watch');
const tests = argv.includes('--tests');

const TEST_DIR = 'test/integration';

/**
 * Paths that must never appear in the extension's module graph.
 *
 * The lint rules in .oxlintrc.json reject the import; this rejects the artifact. It is the
 * stronger of the two, because it sees the graph esbuild actually walked: a server package
 * pulled in transitively, or past an oxlint-disable, still lands here. Shipping a database
 * driver inside a VSIX is a supply-chain and size problem, not a style one.
 */
export const SERVER_ONLY = [
  /(^|\/)packages\/(db|auth|auth-verify|config)\//,
  /(^|\/)apps\/api\//,
  /node_modules\/(pg|pg-[^/]+|drizzle-orm|drizzle-kit|better-auth|@better-auth|hono)\//,
];

/** The server-only modules in an esbuild metafile's input list, if any. */
export function serverCodeIn(inputs) {
  return inputs.filter((file) => SERVER_ONLY.some((pattern) => pattern.test(file)));
}

/**
 * Checks the graph, then writes the output itself.
 *
 * The build runs with `write: false` so that esbuild hands the bytes over instead of putting them
 * on disk. A rejected graph therefore leaves no artifact behind at all — otherwise a failed build
 * would still drop a dist/extension.js carrying the very code this rejects, ready for a later
 * `vsce package` to pick up. Writing from onEnd covers watch mode too.
 *
 * @type {import('esbuild').Plugin}
 */
const assertNoServerCode = {
  name: 'assert-no-server-code',
  setup(build) {
    build.onEnd(async (result) => {
      const offenders = serverCodeIn(Object.keys(result.metafile?.inputs ?? {}));
      if (offenders.length > 0) {
        const text = [
          'Server code reached the extension bundle:',
          ...offenders.map((file) => `  ${file}`),
          'Nothing was written. See SERVER_ONLY in apps/extension/esbuild.mjs.',
        ].join('\n');
        // Printed here rather than left to esbuild: it does not log an onEnd plugin's errors,
        // and in watch mode there is no thrown object for the caller to print either.
        process.stderr.write(`\n\u2716 [assert-no-server-code] ${text}\n\n`);
        return { errors: [{ text }] };
      }
      for (const file of result.outputFiles ?? []) {
        await mkdir(dirname(file.path), { recursive: true });
        await writeFile(file.path, file.contents);
      }
      return null;
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
  metafile: true,
  // The plugin writes; see its comment.
  write: false,
  plugins: [assertNoServerCode],
};

/**
 * The integration suite is bundled too, rather than compiled file-by-file with tsc.
 *
 * VS Code loads the extension from `dist/extension.js`, so bundling the tests means they exercise
 * the same shape of artifact. It also keeps the workspace packages out of the runtime: a
 * `require('@snip-pick/core')` left in plain tsc output resolves to raw TypeScript source and
 * fails to load inside the extension host. Types are still checked by `npm run typecheck`.
 */
/**
 * readdirSync rather than fs.globSync: this package declares Node >= 20, and globSync only landed
 * in Node 22. Called lazily, so a normal build does not need test/integration to exist and this
 * module stays importable.
 */
function testEntryPoints() {
  return readdirSync(TEST_DIR, { recursive: true })
    .map((entry) => String(entry).replace(/\\/g, '/'))
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `${TEST_DIR}/${entry}`);
}

/** @type {() => import('esbuild').BuildOptions} */
const integrationTests = () => ({
  entryPoints: testEntryPoints(),
  bundle: true,
  outdir: 'out/test/integration',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Provided by the extension host and by the test runner respectively.
  external: ['vscode', 'mocha'],
  sourcemap: true,
  logLevel: 'info',
  metafile: true,
  write: false,
  plugins: [assertNoServerCode],
});

// Only when run as a script: the boundary test imports serverCodeIn from here.
if (fileURLToPath(import.meta.url) === argv[1]) {
  const options = tests ? integrationTests() : extension;
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
  } else {
    try {
      await build(options);
    } catch {
      // Diagnostics are already on stderr — esbuild's own, and the plugin's. A stack trace here
      // would only point back into esbuild, which tells nobody anything.
      exit(1);
    }
  }
}
