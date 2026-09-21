/**
 * Discovery, so a user only ever has to type a URL.
 *
 * Every deployment is self-hosted at its own address, so endpoints cannot be hardcoded: the
 * client reads RFC 8414 metadata from the origin and works out the rest.
 */

export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri?: string;
  revocation_endpoint?: string;
  end_session_endpoint?: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
}

export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers?: string[];
}

export interface ServerDescription {
  /** Origin the user typed, normalised. */
  baseUrl: string;
  metadata: AuthorizationServerMetadata;
  /** RFC 8707 resource identifier for the vault API. */
  resource: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class DiscoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiscoveryError';
  }
}

export function normalizeBaseUrl(input: string): string {
  const trimmed = input.trim();
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new DiscoveryError(`"${input}" is not a valid URL.`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

async function getJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new DiscoveryError(`Could not reach ${url}: ${(error as Error).message}`);
  }
  if (!response.ok) {
    throw new DiscoveryError(`${url} answered ${response.status}.`);
  }
  return (await response.json()) as T;
}

/**
 * Reads both metadata documents. The protected-resource document is optional — without it the
 * resource identifier is derived from the base URL, which matches how the API builds it.
 */
export async function describeServer(
  input: string,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<ServerDescription> {
  const baseUrl = normalizeBaseUrl(input);
  const metadata = await getJson<AuthorizationServerMetadata>(
    fetchImpl,
    `${baseUrl}/.well-known/oauth-authorization-server`,
  );
  if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
    throw new DiscoveryError(`${baseUrl} does not look like an OAuth authorization server.`);
  }

  let resource = `${baseUrl}/v1`;
  try {
    const document = await getJson<ProtectedResourceMetadata>(
      fetchImpl,
      `${baseUrl}/.well-known/oauth-protected-resource`,
    );
    if (document.resource) resource = document.resource;
  } catch {
    // Optional document; the derived default is correct for a stock deployment.
  }

  return { baseUrl, metadata, resource };
}
