import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { schema } from './schema.js';

const databaseUrl = process.env.DATABASE_URL;

function normalizeDatabaseUrl(value: string) {
  const url = new URL(value);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode === 'prefer' || sslmode === 'require' || sslmode === 'verify-ca') url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export function createDb(databaseUrlOverride = databaseUrl) {
  if (!databaseUrlOverride) {
    throw new Error('DATABASE_URL is required to connect to the database.');
  }
  const pool = new Pool({ connectionString: normalizeDatabaseUrl(databaseUrlOverride) });
  return { db: drizzle(pool, { schema }), pool };
}

export type Db = ReturnType<typeof createDb>['db'];
