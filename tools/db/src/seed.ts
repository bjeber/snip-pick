import { eq } from 'drizzle-orm';
import { createAuth, seedVsCodeClient } from '@snip-pick/auth';
import { createDb, organization, team, user, type Database } from '@snip-pick/db';
import { describeTarget, localConfig } from './config';

/**
 * A development tenant you can sign in to from the editor.
 *
 * Fixed and well known on purpose: the container these go into is bound to loopback and holds
 * nothing but this. The point is that `pnpm run db:seed` followed by **Snip Pick: Sign In to a
 * Server…** against http://localhost:8787 gets you all the way to a signed-in session without
 * anybody having to invent an account first.
 */
const DEMO = {
  name: 'Dev User',
  email: 'dev@example.com',
  password: 'correct-horse-battery-staple',
  organization: { name: 'Acme Corp', slug: 'acme' },
} as const;

type Auth = ReturnType<typeof createAuth>;

/** Idempotent: the user is created once and found by email every time after that. */
async function ensureUser(db: Database, auth: Auth): Promise<string> {
  const existing = await db.query.user.findFirst({
    where: eq(user.email, DEMO.email),
    columns: { id: true },
  });
  if (existing) return existing.id;

  // Through better-auth rather than an insert: the password has to be hashed the way the sign-in
  // path will verify it, and that algorithm is better-auth's business, not this script's.
  const result = await auth.api.signUpEmail({
    body: { name: DEMO.name, email: DEMO.email, password: DEMO.password },
  });
  return result.user.id;
}

/**
 * Idempotent: the tenant is created once and found by slug after that.
 *
 * Created server-side with an explicit `userId`, which better-auth allows precisely when there
 * is no session to read the creator from — a script has none. That call also makes the user a
 * member and gives the tenant its default team, so nothing else has to be wired up by hand.
 */
async function ensureOrganization(db: Database, auth: Auth, userId: string): Promise<string> {
  const existing = await db.query.organization.findFirst({
    where: eq(organization.slug, DEMO.organization.slug),
    columns: { id: true },
  });
  if (existing) return existing.id;

  const created = await auth.api.createOrganization({
    body: { name: DEMO.organization.name, slug: DEMO.organization.slug, userId },
  });
  if (!created) throw new Error('better-auth did not return the organization it created.');
  return created.id;
}

async function main(): Promise<void> {
  const config = localConfig();
  const { db, close } = createDb(config);
  const auth = createAuth({ db, config });
  process.stdout.write(`Seeding ${describeTarget(config.databaseUrl)}\n`);

  try {
    // The client the extension authenticates as. The running server seeds this too, so that a
    // deployment never needs it done by hand; doing it here means the database is complete
    // before anything is started.
    await seedVsCodeClient(db, config);

    const userId = await ensureUser(db, auth);
    const organizationId = await ensureOrganization(db, auth, userId);
    const teams = await db.query.team.findMany({
      where: eq(team.organizationId, organizationId),
      columns: { name: true },
    });

    process.stdout.write(
      [
        '',
        `  tenant    ${DEMO.organization.name} (${DEMO.organization.slug})`,
        `  teams     ${teams.map((row) => row.name).join(', ') || '(none)'}`,
        `  sign in   ${DEMO.email} / ${DEMO.password}`,
        `  at        ${config.baseUrl}`,
        '',
        // Not seeded, deliberately: the API creates a member's personal vault and a team's
        // project vault the first time they are listed, so that adding either to an existing
        // tenant needs no backfill. Writing them here would be a second copy of that rule.
        '  Vaults appear on first sign-in from the editor; they are created on demand.',
        '',
      ].join('\n'),
    );
  } finally {
    await close();
  }
}

main().then(
  () => {
    process.stdout.write('Seeded.\n');
  },
  (error: unknown) => {
    process.stderr.write(`Seeding failed: ${String(error)}\n`);
    process.exitCode = 1;
  },
);
