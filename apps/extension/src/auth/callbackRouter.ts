import * as vscode from 'vscode';

/**
 * Routes the browser's redirect back to the sign-in attempt that started it.
 *
 * VS Code allows one URI handler per extension, so in-flight flows are keyed by their OAuth
 * `state` — the same value that proves the response belongs to this request.
 */
export class AuthCallbackRouter implements vscode.UriHandler, vscode.Disposable {
  private readonly pending = new Map<string, (uri: vscode.Uri) => void>();
  private readonly registration: vscode.Disposable;

  constructor() {
    this.registration = vscode.window.registerUriHandler(this);
  }

  dispose(): void {
    this.registration.dispose();
    this.pending.clear();
  }

  handleUri(uri: vscode.Uri): void {
    const state = new URLSearchParams(uri.query).get('state');
    if (!state) return;
    const resolve = this.pending.get(state);
    if (!resolve) return;
    this.pending.delete(state);
    resolve(uri);
  }

  /**
   * Resolves with the callback URI for `state`.
   * Rejects if the user cancels or nothing arrives before `timeoutMs`.
   */
  wait(
    state: string,
    cancellation: vscode.CancellationToken,
    timeoutMs = 300_000,
  ): Promise<vscode.Uri> {
    return new Promise<vscode.Uri>((resolve, reject) => {
      const finish = (): void => {
        this.pending.delete(state);
        clearTimeout(timer);
        subscription.dispose();
      };
      const timer = setTimeout(() => {
        finish();
        reject(new Error('Timed out waiting for the browser to come back.'));
      }, timeoutMs);
      const subscription = cancellation.onCancellationRequested(() => {
        finish();
        reject(new Error('Sign-in was cancelled.'));
      });
      this.pending.set(state, (uri) => {
        finish();
        resolve(uri);
      });
    });
  }
}
