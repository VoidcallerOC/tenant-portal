import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

const { db, pool } = createDb();
try {
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('Database migrations applied.');
} finally {
  await pool.end();
}
