import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { oauthClient, oauthClientResource } from '@snip-pick/db';
import { db } from './db';
import { VSCODE_CLIENT_ID } from '@snip-pick/config';
import { config } from './config';

/**
 * Seeds the first-party VS Code client.
 *
 * Every deployment lives at its own URL, so the alternative is asking each administrator to hand
 * register a client before anyone can sign in. Seeding a well-known public client removes that
 * step without opening unauthenticated dynamic registration to the world.
 *
 * It is a public client (`token_endpoint_auth_method: "none"`), which is what a desktop
 * application must be — it cannot keep a secret — and is exactly what makes the server enforce
 * PKCE on it.
 */
export async function seedVsCodeClient(): Promise<void> {
  const now = new Date();
  const values = {
    name: 'Snip Pick for VS Code',
    // Copied, not aliased: the config is readonly and drizzle wants an owned array.
    redirectUris: [...config.vscodeRedirectUris],
    tokenEndpointAuthMethod: 'none',
    applicationType: 'native',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    requirePKCE: true,
    // First-party: the company's own editor extension does not ask its own users for consent.
    skipConsent: true,
    enableEndSession: true,
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    disabled: false,
    updatedAt: now,
  };

  await db
    .insert(oauthClient)
    .values({ id: VSCODE_CLIENT_ID, clientId: VSCODE_CLIENT_ID, createdAt: now, ...values })
    .onConflictDoUpdate({ target: oauthClient.clientId, set: values });

  await linkClientToResource(VSCODE_CLIENT_ID, config.resource);
}

/**
 * Binds a client to a protected resource.
 *
 * Without this the authorization server refuses the `resource` parameter with `invalid_target`:
 * a client may only ask for tokens scoped to resources it has been linked to. That check is the
 * point of audience binding, so the link is explicit here rather than disabled globally.
 */
export async function linkClientToResource(clientId: string, resource: string): Promise<void> {
  const existing = await db.query.oauthClientResource.findFirst({
    where: and(
      eq(oauthClientResource.clientId, clientId),
      eq(oauthClientResource.resourceId, resource),
    ),
    columns: { id: true },
  });
  if (existing) return;
  await db
    .insert(oauthClientResource)
    .values({
      id: randomUUID(),
      clientId,
      resourceId: resource,
      createdAt: new Date(),
    })
    .onConflictDoNothing();
}

/** Whether the seeded client is present — used by the health check. */
export async function vsCodeClientExists(): Promise<boolean> {
  const row = await db.query.oauthClient.findFirst({
    where: eq(oauthClient.clientId, VSCODE_CLIENT_ID),
    columns: { id: true },
  });
  return row !== undefined;
}
