import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { config } from '../config';
import * as authSchema from './auth-schema';
import * as appSchema from './schema';

export const schema = { ...authSchema, ...appSchema };

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export const db = drizzle(pool, { schema });

export type Database = typeof db;
