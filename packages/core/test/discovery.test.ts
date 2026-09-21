import { describe, expect, it } from 'vitest';
import {
  detectPackageManager,
  parseJustfileRecipes,
  parseMakefileTargets,
  parsePackageScripts,
  runScriptCommand,
} from '../src/discovery/parsers';

describe('detectPackageManager', () => {
  it('reads the lockfile', () => {
    expect(detectPackageManager(['pnpm-lock.yaml'])).toBe('pnpm');
    expect(detectPackageManager(['yarn.lock'])).toBe('yarn');
    expect(detectPackageManager(['bun.lockb'])).toBe('bun');
    expect(detectPackageManager(['package-lock.json'])).toBe('npm');
  });

  it('defaults to npm', () => {
    expect(detectPackageManager(['package.json'])).toBe('npm');
    expect(detectPackageManager([])).toBe('npm');
  });

  it('prefers the more specific lockfile when several exist', () => {
    expect(detectPackageManager(['package-lock.json', 'pnpm-lock.yaml'])).toBe('pnpm');
  });
});

describe('runScriptCommand', () => {
  it('uses each manager’s own spelling', () => {
    expect(runScriptCommand('npm', 'build')).toBe('npm run build');
    expect(runScriptCommand('pnpm', 'build')).toBe('pnpm run build');
    expect(runScriptCommand('yarn', 'build')).toBe('yarn build');
    expect(runScriptCommand('bun', 'build')).toBe('bun run build');
  });
});

describe('parsePackageScripts', () => {
  it('lists scripts with the underlying command as detail', () => {
    const tasks = parsePackageScripts(
      '{ "scripts": { "build": "tsc -p .", "test": "vitest" } }',
      'pnpm',
    );
    expect(tasks).toEqual([
      { name: 'build', command: 'pnpm run build', detail: 'tsc -p .' },
      { name: 'test', command: 'pnpm run test', detail: 'vitest' },
    ]);
  });

  it('tolerates comments and missing scripts', () => {
    expect(parsePackageScripts('{ // nothing here\n "name": "x" }')).toEqual([]);
    expect(parsePackageScripts('not json')).toEqual([]);
    expect(parsePackageScripts('{ "scripts": { "a": 5 } }')).toEqual([]);
  });
});

describe('parseMakefileTargets', () => {
  const makefile = [
    '.PHONY: build test',
    'CC = gcc',
    'CFLAGS := -O2',
    '',
    '# a comment',
    'build: deps',
    '\tgo build ./...',
    'test lint:',
    '\tgo test ./...',
    '%.o: %.c',
    '\t$(CC) -c $<',
  ].join('\n');

  it('finds real targets', () => {
    expect(parseMakefileTargets(makefile).map((task) => task.name)).toEqual([
      'build',
      'test',
      'lint',
    ]);
  });

  it('builds a runnable command', () => {
    expect(parseMakefileTargets('build:\n\techo hi')[0]).toEqual({
      name: 'build',
      command: 'make build',
    });
  });

  it('skips variables, pattern rules and dot targets', () => {
    const names = parseMakefileTargets(makefile).map((task) => task.name);
    expect(names).not.toContain('CC');
    expect(names).not.toContain('CFLAGS');
    expect(names).not.toContain('.PHONY');
    expect(names.some((name) => name.includes('%'))).toBe(false);
  });

  it('handles CRLF line endings', () => {
    expect(parseMakefileTargets('build:\r\n\techo hi\r\n').map((t) => t.name)).toEqual(['build']);
  });
});

describe('parseJustfileRecipes', () => {
  const justfile = [
    '# comment',
    'set shell := ["bash", "-c"]',
    'export VERSION := "1.0"',
    'alias b := build',
    '',
    'build:',
    '    cargo build',
    'test filter="":',
    '    cargo test {{filter}}',
    'deploy env: build',
    '    ./deploy.sh {{env}}',
  ].join('\n');

  it('finds recipes and skips settings and aliases', () => {
    expect(parseJustfileRecipes(justfile).map((task) => task.name)).toEqual([
      'build',
      'test',
      'deploy',
    ]);
  });

  it('records parameters as detail', () => {
    const deploy = parseJustfileRecipes(justfile).find((task) => task.name === 'deploy');
    expect(deploy).toEqual({ name: 'deploy', command: 'just deploy', detail: 'deploy env' });
  });

  it('ignores indented recipe bodies', () => {
    expect(parseJustfileRecipes('build:\n    other: thing').map((t) => t.name)).toEqual(['build']);
  });
});
