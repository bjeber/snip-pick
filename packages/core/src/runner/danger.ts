/**
 * Pure heuristics that flag shell commands worth a second look before they hit a terminal.
 * False positives are cheap (one extra modal), false negatives are not.
 */

export interface DangerMatch {
  id: string;
  label: string;
}

interface Rule {
  id: string;
  label: string;
  test: (command: string, tokens: string[]) => boolean;
}

function tokenize(command: string): string[] {
  return command.split(/\s+/).filter((token) => token.length > 0);
}

function baseName(token: string): string {
  const slash = token.lastIndexOf('/');
  return slash === -1 ? token : token.slice(slash + 1);
}

/** Short flags (`-rf`) and long flags (`--force`) following `commandName`, across the whole line. */
function flagsAfter(tokens: string[], commandName: string): { short: string; long: string[] } {
  let short = '';
  const long: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (baseName(tokens[i]!) !== commandName) continue;
    for (let j = i + 1; j < tokens.length; j += 1) {
      const token = tokens[j]!;
      if (token === '&&' || token === '||' || token === ';' || token === '|') break;
      if (token.startsWith('--')) long.push(token.split('=')[0]!);
      else if (token.startsWith('-') && token.length > 1) short += token.slice(1);
    }
  }
  return { short, long };
}

const RULES: Rule[] = [
  {
    id: 'rm-recursive-force',
    label: 'Recursive, forced delete (rm -rf)',
    test: (_command, tokens) => {
      const { short, long } = flagsAfter(tokens, 'rm');
      const recursive = /[rR]/.test(short) || long.includes('--recursive');
      const force = short.includes('f') || long.includes('--force');
      return recursive && force;
    },
  },
  {
    id: 'force-flag',
    label: 'Forced operation (--force)',
    test: (command) => /(^|\s)--force(-with-lease)?(\s|=|$)/.test(command),
  },
  {
    id: 'git-push-force',
    label: 'Force push (git push -f)',
    test: (_command, tokens) => {
      const gitIndex = tokens.findIndex((token) => baseName(token) === 'git');
      if (gitIndex === -1) return false;
      const rest = tokens.slice(gitIndex + 1);
      if (!rest.includes('push')) return false;
      return rest.some(
        (token) =>
          token === '-f' ||
          token === '--force' ||
          token === '--force-with-lease' ||
          token.startsWith('--force-with-lease=') ||
          (/^-[a-zA-Z]+$/.test(token) && token.includes('f')),
      );
    },
  },
  {
    id: 'drop-database',
    label: 'Destructive SQL (DROP DATABASE / DROP TABLE)',
    test: (command) => /\bdrop\s+(database|table)\b/i.test(command),
  },
  {
    id: 'mkfs',
    label: 'Filesystem creation (mkfs)',
    test: (command) => /\bmkfs(\.[a-z0-9]+)?\b/i.test(command),
  },
  {
    id: 'dd',
    label: 'Raw disk write (dd if=…)',
    test: (command) => /\bdd\b[^\n]*\bif=/.test(command),
  },
  {
    id: 'fork-bomb',
    label: 'Fork bomb',
    test: (command) => /:\s*\(\s*\)\s*\{/.test(command),
  },
  {
    id: 'chmod-777',
    label: 'World-writable permissions (chmod -R 777)',
    test: (command, tokens) => {
      if (!tokens.some((token) => baseName(token) === 'chmod')) return false;
      const { short, long } = flagsAfter(tokens, 'chmod');
      const recursive = /[rR]/.test(short) || long.includes('--recursive');
      return recursive && /\b777\b/.test(command);
    },
  },
  {
    id: 'device-write',
    label: 'Write to a block device (> /dev/…)',
    test: (command) => /(>|of=)\s*\/dev\/(sd|nvme|disk|hd)/i.test(command),
  },
  {
    id: 'sudo',
    label: 'Runs as root (sudo)',
    test: (_command, tokens) => tokens.some((token) => baseName(token) === 'sudo'),
  },
];

/** Returns every rule that matched, in rule order. */
export function detectDangerous(command: string): DangerMatch[] {
  const tokens = tokenize(command);
  return RULES.filter((rule) => rule.test(command, tokens)).map(({ id, label }) => ({ id, label }));
}

export function isDangerous(command: string): boolean {
  return detectDangerous(command).length > 0;
}

/** Human-readable reason list, e.g. for a confirmation modal. */
export function describeDanger(matches: readonly DangerMatch[]): string {
  return matches.map((match) => `• ${match.label}`).join('\n');
}
