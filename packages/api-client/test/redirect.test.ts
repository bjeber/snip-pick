import { describe, expect, it } from 'vitest';
import { registrableRedirectUri } from '../src/authorize';

describe('registrableRedirectUri', () => {
  it('drops the windowId asExternalUri adds to the editor-scheme callback', () => {
    // The real value observed in VS Code 1.138 on the desktop. With the query left on, the
    // authorization server's exact-string comparison fails and the flow ends at invalid_redirect.
    expect(registrableRedirectUri('vscode://bieber.snip-pick/auth?windowId=1', 'vscode')).toBe(
      'vscode://bieber.snip-pick/auth',
    );
  });

  it('leaves a callback that is already registrable alone', () => {
    expect(registrableRedirectUri('vscode://bieber.snip-pick/auth', 'vscode')).toBe(
      'vscode://bieber.snip-pick/auth',
    );
  });

  it('follows the editor, not the literal string vscode', () => {
    expect(
      registrableRedirectUri(
        'vscode-insiders://bieber.snip-pick/auth?windowId=3',
        'vscode-insiders',
      ),
    ).toBe('vscode-insiders://bieber.snip-pick/auth');
  });

  it('keeps the query of an https tunnel, which is the tunnel addressing itself', () => {
    const tunnelled = 'https://vscode.dev/redirect?windowId=2&path=%2Fauth';
    expect(registrableRedirectUri(tunnelled, 'vscode')).toBe(tunnelled);
  });

  it('drops a fragment too, which a redirect URI may not carry', () => {
    expect(registrableRedirectUri('vscode://bieber.snip-pick/auth#x', 'vscode')).toBe(
      'vscode://bieber.snip-pick/auth',
    );
  });

  it('passes anything unparseable through rather than inventing a URL', () => {
    expect(registrableRedirectUri('not a uri', 'vscode')).toBe('not a uri');
  });
});
