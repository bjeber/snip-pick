import { serve } from '@hono/node-server';
import { seedVsCodeClient } from '@snip-pick/auth';
import { config } from './config';
import { db } from './db';
import { createApp } from './http/app';

async function main(): Promise<void> {
  await seedVsCodeClient(db, config);
  serve({ fetch: createApp().fetch, port: config.port }, (info) => {
    process.stdout.write(`Snip Pick API listening on http://localhost:${info.port}\n`);
    process.stdout.write(`  issuer:   ${config.baseUrl}\n`);
    process.stdout.write(`  resource: ${config.resource}\n`);
  });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start: ${String(error)}\n`);
  process.exitCode = 1;
});
