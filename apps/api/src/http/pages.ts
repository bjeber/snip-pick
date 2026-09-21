/**
 * The two browser-facing pages the OAuth flow needs.
 *
 * Deliberately dependency-free server-rendered HTML: this is an API, and a sign-in form is not a
 * reason to grow a frontend build. Everything is inline behind a nonce-based CSP.
 */
import { randomBytes } from 'node:crypto';

function nonce(): string {
  return randomBytes(24).toString('base64url');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLES = `
  :root { color-scheme: light dark; --fg: #1d2129; --muted: #6b7280; --bg: #f6f7f9;
    --card: #ffffff; --border: #dfe3e8; --accent: #1f6feb; --accent-fg: #ffffff; }
  @media (prefers-color-scheme: dark) {
    :root { --fg: #e6e9f0; --muted: #9aa3b2; --bg: #14171d; --card: #1e2430;
      --border: #2c3442; --accent: #4e8cff; --accent-fg: #10131a; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px;
    background: var(--bg); color: var(--fg);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { width: 100%; max-width: 26rem; background: var(--card); border: 1px solid var(--border);
    border-radius: 12px; padding: 28px; }
  h1 { margin: 0 0 4px; font-size: 1.3rem; }
  p.lede { margin: 0 0 20px; color: var(--muted); font-size: 0.92rem; }
  label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 0.9rem; }
  input { width: 100%; padding: 10px 12px; margin-bottom: 14px; border-radius: 8px;
    border: 1px solid var(--border); background: var(--bg); color: var(--fg); font: inherit; }
  input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
  button { width: 100%; padding: 11px 16px; border: none; border-radius: 8px; cursor: pointer;
    background: var(--accent); color: var(--accent-fg); font: inherit; font-weight: 600; }
  button.secondary { background: transparent; color: var(--fg);
    border: 1px solid var(--border); margin-top: 8px; }
  .scopes { margin: 0 0 20px; padding-left: 20px; color: var(--muted); font-size: 0.92rem; }
  .error { display: none; margin: 0 0 14px; padding: 10px 12px; border-radius: 8px;
    background: #d72c2c1a; color: #d72c2c; font-size: 0.9rem; }
  .error[data-shown] { display: block; }
  footer { margin-top: 18px; color: var(--muted); font-size: 0.8rem; text-align: center; }
`;

function page(title: string, body: string, script: string, id: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${id}'; script-src 'nonce-${id}'; form-action 'self'; connect-src 'self'" />
<title>${escapeHtml(title)}</title>
<style nonce="${id}">${STYLES}</style>
</head>
<body>
<main>
${body}
</main>
<script nonce="${id}">${script}</script>
</body>
</html>`;
}

/**
 * Sign-in. The authorization server redirected here with the *signed* authorization query
 * attached, so after authenticating we hand the very same query string back to `/oauth2/authorize`
 * to resume where the client left off.
 */
export function signInPage(appName: string, basePath: string): string {
  const id = nonce();
  const body = `
  <h1>Sign in</h1>
  <p class="lede">Continue to ${escapeHtml(appName)}.</p>
  <p class="error" id="error"></p>
  <form id="form">
    <label for="email">Email</label>
    <input type="email" id="email" name="email" autocomplete="username" required autofocus />
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autocomplete="current-password" required />
    <button type="submit" id="submit">Sign in</button>
  </form>
  <footer>Authorizing a device you do not recognise? Close this page.</footer>`;

  const script = `
  const form = document.getElementById('form');
  const error = document.getElementById('error');
  const submit = document.getElementById('submit');
  const resume = window.location.search;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.removeAttribute('data-shown');
    submit.disabled = true;
    submit.textContent = 'Signing in…';
    try {
      const response = await fetch('${basePath}/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.message || 'Those credentials were not accepted.');
      }
      window.location.assign('${basePath}/oauth2/authorize' + resume);
    } catch (failure) {
      error.textContent = failure.message;
      error.setAttribute('data-shown', '');
      submit.disabled = false;
      submit.textContent = 'Sign in';
    }
  });`;

  return page('Sign in', body, script, id);
}

/**
 * Consent. First-party clients are seeded with `skipConsent`, so in practice this is for
 * third-party clients registered against a deployment.
 */
export function consentPage(clientName: string, scopes: string[], basePath: string): string {
  const id = nonce();
  const items = scopes.map((scope) => `<li>${escapeHtml(scope)}</li>`).join('');
  const body = `
  <h1>Authorize ${escapeHtml(clientName)}</h1>
  <p class="lede">It is asking for:</p>
  <ul class="scopes">${items || '<li>basic account access</li>'}</ul>
  <p class="error" id="error"></p>
  <button type="button" id="accept">Allow</button>
  <button type="button" class="secondary" id="deny">Deny</button>`;

  const script = `
  const error = document.getElementById('error');
  const code = new URLSearchParams(window.location.search).get('code');

  async function decide(accept) {
    error.removeAttribute('data-shown');
    try {
      const response = await fetch('${basePath}/oauth2/consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code, accept }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Could not record that decision.');
      if (body.redirectURI || body.redirect_uri) {
        window.location.assign(body.redirectURI || body.redirect_uri);
      } else {
        document.querySelector('main').innerHTML =
          '<h1>Done</h1><p class="lede">You can close this page.</p>';
      }
    } catch (failure) {
      error.textContent = failure.message;
      error.setAttribute('data-shown', '');
    }
  }

  document.getElementById('accept').addEventListener('click', () => decide(true));
  document.getElementById('deny').addEventListener('click', () => decide(false));`;

  return page('Authorize', body, script, id);
}
