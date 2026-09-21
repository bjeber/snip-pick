import { describe, expect, it } from 'vitest';
import { renderEditorHtml } from '../../src/ui/editor/html';
import { makeItem } from './helpers';

// `html.ts` only imports `vscode` as a type, so the markup can be checked without an editor.
const webview = { cspSource: 'vscode-webview://test' } as never;

function render(item = makeItem()) {
  return renderEditorHtml(webview, item, [{ id: 'g1', label: 'Parent / Child' }]);
}

describe('renderEditorHtml', () => {
  it('locks everything down with a nonce-based CSP', () => {
    const html = render();
    const csp = /content="([^"]+)"/.exec(html)?.[1] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');

    const nonce = /nonce-([A-Za-z0-9]+)/.exec(csp)?.[1];
    expect(nonce).toMatch(/^[A-Za-z0-9]{32}$/);
    for (const [, tagNonce] of html.matchAll(/<(?:script|style)[^>]*nonce="([^"]+)"/g)) {
      expect(tagNonce).toBe(nonce);
    }
    expect(html).not.toMatch(/<(?:script|style)(?![^>]*nonce=)/);
  });

  it('uses a fresh nonce each time', () => {
    expect(/nonce-([A-Za-z0-9]+)/.exec(render())?.[1]).not.toBe(
      /nonce-([A-Za-z0-9]+)/.exec(render())?.[1],
    );
  });

  it('avoids inline style attributes, which a nonce cannot cover', () => {
    expect(render()).not.toMatch(/\sstyle="/);
  });

  it('loads no external resources', () => {
    const html = render();
    expect(html).not.toMatch(/<(?:script|img|link)[^>]+(?:src|href)="https?:/);
  });

  it('seeds the form with the item and its groups', () => {
    const html = render(
      makeItem({
        title: 'Tail logs',
        type: 'command',
        body: 'docker compose logs -f {{service}}',
        groupId: 'g1',
        tags: ['docker', 'ops'],
        context: { languages: ['dockerfile'], globs: ['**/compose.yaml'] },
        cwd: 'fileDir',
        confirm: true,
        steps: ['a', 'b'],
      }),
    );
    expect(html).toContain('"title":"Tail logs"');
    expect(html).toContain('"tags":"docker, ops"');
    expect(html).toContain('"languages":"dockerfile"');
    expect(html).toContain('"globs":"**/compose.yaml"');
    expect(html).toContain('"cwd":"fileDir"');
    expect(html).toContain('"confirm":true');
    expect(html).toContain('"steps":"a\\nb"');
    expect(html).toContain('Parent / Child');
  });

  it('escapes anything that could close the script block', () => {
    const html = render(makeItem({ title: '</script><script>alert(1)</script>' }));
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html).toContain('\\u003c/script');
  });
});
