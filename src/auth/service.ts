import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { sessions, users } from '../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';

export const SESSION_COOKIE = 'tenant_portal_session';
export const SESSION_TTL_MS = 1000 * 60 * 60 * 8;

export async function authenticate(db: Db, email: string, password: string) {
  const rows = await db.select().from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1);
  const user = rows[0];
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) return null;
  return user;
}

export async function createSession(db: Db, userId: string, now = new Date()) {
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const [session] = await db.insert(sessions).values({ userId, expiresAt, lastSeenAt: now }).returning({ id: sessions.id, expiresAt: sessions.expiresAt });
  if (!session) throw new Error('Unable to create session.');
  return session;
}

export async function getUserForSession(db: Db, sessionId: string, now = new Date()) {
  const rows = await db.select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(
      eq(sessions.id, sessionId),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, now),
    ))
    .limit(1);
  const row = rows[0];
  return row?.user ?? null;
}

export async function revokeSession(db: Db, sessionId: string) {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

export { hashPassword };
