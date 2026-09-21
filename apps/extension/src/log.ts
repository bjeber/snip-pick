import * as vscode from 'vscode';

let channel: vscode.LogOutputChannel | undefined;

export function initLog(): vscode.LogOutputChannel {
  channel ??= vscode.window.createOutputChannel('Snip Pick', { log: true });
  return channel;
}

/** The extension's LogOutputChannel. Falls back to creating it on first use. */
export function log(): vscode.LogOutputChannel {
  return initLog();
}
