import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema.js';

const databaseUrl = process.env.DATABASE_URL;

export function createDb(databaseUrlOverride = databaseUrl) {
  if (!databaseUrlOverride) {
    throw new Error('DATABASE_URL is required to connect to the database.');
  }
  const pool = new Pool({ connectionString: databaseUrlOverride });
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>['db'];
