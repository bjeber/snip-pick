import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env';
import * as authSchema from './auth-schema';
import * as appSchema from './schema';

export const schema = { ...authSchema, ...appSchema };

export const pool = new pg.Pool({ connectionString: env.databaseUrl });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
