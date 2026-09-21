import { serve } from '@hono/node-server';
import { seedVsCodeClient } from './bootstrap';
import { env } from './env';
import { createApp } from './http/app';

async function main(): Promise<void> {
  await seedVsCodeClient();
  serve({ fetch: createApp().fetch, port: env.port }, (info) => {
    process.stdout.write(`Snip Pick API listening on http://localhost:${info.port}\n`);
    process.stdout.write(`  issuer:   ${env.baseUrl}\n`);
    process.stdout.write(`  resource: ${env.resource}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
