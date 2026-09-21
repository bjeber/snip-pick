import { build, context } from 'esbuild';
import { globSync } from 'node:fs';
import process from 'node:process';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

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
};

/**
 * The integration suite is bundled too, rather than compiled file-by-file with tsc.
 *
 * VS Code loads the extension from `dist/extension.js`, so bundling the tests means they exercise
 * the same shape of artifact. It also keeps the workspace packages out of the runtime: a
 * `require('@snip-pick/core')` left in plain tsc output resolves to raw TypeScript source and
 * fails to load inside the extension host. Types are still checked by `npm run typecheck`.
 */
/** @type {import('esbuild').BuildOptions} */
const integrationTests = {
  entryPoints: globSync('test/integration/**/*.ts'),
  bundle: true,
  outdir: 'out/test/integration',
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // Provided by the extension host and by the test runner respectively.
  external: ['vscode', 'mocha'],
  sourcemap: true,
  logLevel: 'info',
};

const options = tests ? integrationTests : extension;

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
