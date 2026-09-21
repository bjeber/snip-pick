import { describe, expect, it } from 'vitest';
import {
  collectPlaceholders,
  parseTemplate,
  renderTemplate,
  resolveTemplate,
} from '../src/runner/variables';

describe('parseTemplate', () => {
  it('returns a single text node for plain text', () => {
    expect(parseTemplate('npm run build')).toEqual([{ kind: 'text', value: 'npm run build' }]);
  });

  it('parses a bare prompt variable', () => {
    expect(parseTemplate('deploy {{env}}')).toEqual([
      { kind: 'text', value: 'deploy ' },
      { kind: 'prompt', name: 'env' },
    ]);
  });

  it('parses a prompt variable with a default', () => {
    expect(parseTemplate('{{env:staging}}')).toEqual([
      { kind: 'prompt', name: 'env', defaultValue: 'staging' },
    ]);
  });

  it('keeps colons inside a default value', () => {
    expect(parseTemplate('{{url:https://example.com}}')).toEqual([
      { kind: 'prompt', name: 'url', defaultValue: 'https://example.com' },
    ]);
  });

  it('parses secrets', () => {
    expect(parseTemplate('curl -H "$AUTH: {{secret:TOKEN}}"')).toContainEqual({
      kind: 'secret',
      name: 'TOKEN',
    });
  });

  it('parses known built-ins and leaves shell variables alone', () => {
    expect(parseTemplate('cat ${file} ${HOME}')).toEqual([
      { kind: 'text', value: 'cat ' },
      { kind: 'builtin', name: 'file' },
      { kind: 'text', value: ' ${HOME}' },
    ]);
  });

  it('honours escapes', () => {
    expect(parseTemplate('echo \\{{literal}}')).toEqual([
      { kind: 'text', value: 'echo {{literal}}' },
    ]);
    expect(parseTemplate('echo \\${file}')).toEqual([{ kind: 'text', value: 'echo ${file}' }]);
  });

  it('treats an unterminated placeholder as text', () => {
    expect(parseTemplate('echo {{oops')).toEqual([{ kind: 'text', value: 'echo {{oops' }]);
  });

  it('treats an empty placeholder as text', () => {
    expect(parseTemplate('a {{}} b')).toEqual([{ kind: 'text', value: 'a {{}} b' }]);
  });

  it('never throws on odd input', () => {
    for (const input of ['{{', '}}', '${', '\\', '{{secret:}}', '{{:x}}', '${}']) {
      expect(() => parseTemplate(input)).not.toThrow();
    }
  });
});

describe('collectPlaceholders', () => {
  it('deduplicates and preserves order of first appearance', () => {
    const placeholders = collectPlaceholders(
      parseTemplate('{{b}} {{a:1}} {{b}} {{secret:T}} {{secret:T}} ${file} ${file}'),
    );
    expect(placeholders.prompts).toEqual([{ name: 'b' }, { name: 'a', defaultValue: '1' }]);
    expect(placeholders.secrets).toEqual(['T']);
    expect(placeholders.builtins).toEqual(['file']);
  });

  it('picks up a default declared on a later occurrence', () => {
    const placeholders = collectPlaceholders(parseTemplate('{{x}} {{x:fallback}}'));
    expect(placeholders.prompts).toEqual([{ name: 'x', defaultValue: 'fallback' }]);
  });
});

describe('renderTemplate', () => {
  it('substitutes prompts, secrets and built-ins', () => {
    const output = resolveTemplate('deploy {{env}} ${file} {{secret:TOKEN}}', {
      prompts: { env: 'prod' },
      secrets: { TOKEN: 's3cret' },
      builtins: { file: '/tmp/a.ts' },
    });
    expect(output).toBe('deploy prod /tmp/a.ts s3cret');
  });

  it('falls back to the default, then to an empty string', () => {
    expect(resolveTemplate('{{env:staging}}')).toBe('staging');
    expect(resolveTemplate('{{env}}')).toBe('');
    expect(resolveTemplate('${selectedText}')).toBe('');
  });

  it('round-trips escaped braces', () => {
    expect(resolveTemplate('echo \\{{not-a-var}}')).toBe('echo {{not-a-var}}');
  });

  it('renders every occurrence of a repeated variable', () => {
    expect(renderTemplate(parseTemplate('{{a}}-{{a}}'), { prompts: { a: 'x' } })).toBe('x-x');
  });
});
