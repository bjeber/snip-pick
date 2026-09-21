import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  label: 'integration',
  files: 'out/apps/extension/test/integration/**/*.test.js',
  version: 'stable',
  workspaceFolder: './test/fixtures/workspace',
  mocha: {
    ui: 'tdd',
    timeout: 60000,
  },
  launchArgs: ['--disable-extensions', '--disable-gpu', '--disable-workspace-trust'],
});
