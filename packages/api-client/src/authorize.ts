/**
 * Pure construction and validation of the authorization request and its callback.
 * No I/O, so the security-relevant parts (state checking, issuer checking) are directly testable.
 */

export interface AuthorizeRequest {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  nonce: string;
  codeChallenge: string;
  /** RFC 8707: the API the resulting access token should be valid for. */
  resource?: string;
  prompt?: 'none' | 'login' | 'consent' | 'select_account';
}

export function buildAuthorizeUrl(request: AuthorizeRequest): string {
  const url = new URL(request.authorizationEndpoint);
  const params = url.searchParams;
  params.set('response_type', 'code');
  params.set('client_id', request.clientId);
  params.set('redirect_uri', request.redirectUri);
  params.set('scope', request.scopes.join(' '));
  params.set('state', request.state);
  params.set('nonce', request.nonce);
  params.set('code_challenge', request.codeChallenge);
  params.set('code_challenge_method', 'S256');
  if (request.resource) params.set('resource', request.resource);
  if (request.prompt) params.set('prompt', request.prompt);
  return url.toString();
}

export class AuthorizationError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export interface CallbackExpectation {
  state: string;
  /** Expected `iss` (RFC 9207). Checked when the server sends one. */
  issuer?: string;
}

/**
 * Validates the redirect the browser came back with and extracts the authorization code.
 *
 * Throws rather than returning a result type: every failure here is a security failure, and the
 * caller has nothing useful to do but abandon the flow.
 */
export function parseCallback(callbackUrl: string, expected: CallbackExpectation): string {
  const url = new URL(callbackUrl);
  const params = url.searchParams;

  const error = params.get('error');
  if (error) {
    throw new AuthorizationError(params.get('error_description') ?? error, error);
  }

  const state = params.get('state');
  if (state !== expected.state) {
    // Either a stale redirect or a cross-site attempt; both mean: do not continue.
    throw new AuthorizationError(
      'The authorization response did not match this request.',
      'state_mismatch',
    );
  }

  // RFC 9207 — guards against a mixed-up authorization server when a client knows several.
  const issuer = params.get('iss');
  if (expected.issuer && issuer && issuer !== expected.issuer) {
    throw new AuthorizationError(
      `The response came from ${issuer}, not ${expected.issuer}.`,
      'issuer_mismatch',
    );
  }

  const code = params.get('code');
  if (!code) {
    throw new AuthorizationError('The authorization response carried no code.', 'missing_code');
  }
  return code;
}
