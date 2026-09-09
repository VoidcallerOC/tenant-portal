import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { createDb } from './db/client.js';
import { documents, leases, maintenanceComments, maintenanceRequests, properties, tenants, units, users } from './db/schema.js';
import { AuthError, requireAuthenticated, requireRole } from './auth/authorization.js';
import { authenticate, createSession, getUserForSession, revokeSession, SESSION_COOKIE } from './auth/service.js';
import { getDashboard, getPropertyDetail, listProperties } from './management/queries.js';
import { propertyCreateInput, unitCreateInput, unitUpdateInput, uuidParam } from './management/validation.js';
import { getTenantContext, getTenantDocuments, tenantDashboard } from './tenant/queries.js';
import { tenantProfileUpdateInput } from './tenant/validation.js';

const loginInput = z.object({ email: z.string().email(), password: z.string().min(1) });
const idInput = z.string().uuid();
const tenantMaintenanceInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10_000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']).default('MEDIUM'),
}).strict();
const maintenanceCommentInput = z.object({ body: z.string().trim().min(1).max(5_000) }).strict();
const maintenanceStatusInput = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }).strict();
const maintenanceFilterInput = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
type AuthenticatedRequest = Request & { authUser: NonNullable<Awaited<ReturnType<typeof getUserForSession>>> };

function readCookie(req: Request, name: string) {
  const pair = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return pair ? decodeURIComponent(pair.slice(name.length + 1)) : undefined;
}
function serializeSessionCookie(value: string, expires: Date) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function sendAuthError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
  return next(error);
}

export function createApp(databaseUrl?: string) {
  const { db, pool } = createDb(databaseUrl);
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  const clientRoot = fileURLToPath(new URL('../client/', import.meta.url));
  app.use(express.static(clientRoot, { index: false }));

  app.get('/login', (_req, res) => res.status(200).json({ route: '/login', message: 'Submit credentials to POST /login.' }));
  app.post('/login', async (req, res, next) => {
    try {
      const input = loginInput.parse(req.body);
      const user = await authenticate(db, input.email, input.password);
      if (!user) return res.status(401).json({ error: 'Invalid email or password.' });
      const session = await createSession(db, user.id);
      res.setHeader('Set-Cookie', serializeSessionCookie(session.id, session.expiresAt));
      return res.status(200).json({ user: publicUser(user), redirect: user.role === 'TENANT' ? '/tenant' : '/admin' });
    } catch (error) { return next(error); }
  });

  app.use(async (req: Request, _res, next) => {
    try {
      const sessionId = readCookie(req, SESSION_COOKIE);
      const authUser = sessionId && idInput.safeParse(sessionId).success ? await getUserForSession(db, sessionId) : null;
      (req as AuthenticatedRequest).authUser = authUser as AuthenticatedRequest['authUser'];
      return next();
    } catch (error) { return next(error); }
  });
  const requireManagement = (req: Request, res: Response, next: NextFunction) => { try { requireRole((req as AuthenticatedRequest).authUser, 'ADMIN', 'MANAGER'); return next(); } catch (error) { return sendAuthError(error, res, next); } };
  const requireTenant = (req: Request, res: Response, next: NextFunction) => { try { requireRole((req as AuthenticatedRequest).authUser, 'TENANT'); return next(); } catch (error) { return sendAuthError(error, res, next); } };
  const requireAnyAuth = (req: Request, res: Response, next: NextFunction) => { try { requireAuthenticated((req as AuthenticatedRequest).authUser); return next(); } catch (error) { return sendAuthError(error, res, next); } };

  app.post('/logout', requireAnyAuth, async (req, res, next) => {
    try {
      const sessionId = readCookie(req, SESSION_COOKIE);
      if (sessionId && idInput.safeParse(sessionId).success) await revokeSession(db, sessionId);
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      return res.status(204).send();
    } catch (error) { return next(error); }
  });

  app.get('/admin/dashboard', requireManagement, async (req, res, next) => {
    try { return res.json(await getDashboard(db, (req as AuthenticatedRequest).authUser.organizationId)); } catch (error) { return next(error); }
  });
  app.get('/admin', requireManagement, (_req, res) => res.sendFile(`${clientRoot}/admin.html`));
  app.get('/admin/properties/new', requireManagement, (_req, res) => res.sendFile(`${clientRoot}/admin.html`));
  app.post('/admin/properties', requireManagement, async (req, res, next) => {
    try { const input = propertyCreateInput.parse(req.body); const [property] = await db.insert(properties).values({ ...input, organizationId: (req as AuthenticatedRequest).authUser.organizationId }).returning(); return res.status(201).json(property); } catch (error) { return next(error); }
  });
  app.get('/admin/properties', requireManagement, async (req, res, next) => {
    try { return res.json(await listProperties(db, (req as AuthenticatedRequest).authUser.organizationId)); } catch (error) { return next(error); }
  });
  app.get('/admin/properties/:id', requireManagement, async (req, res, next) => {
    try { const { id } = uuidParam.parse(req.params); const detail = await getPropertyDetail(db, (req as AuthenticatedRequest).authUser.organizationId, id); return detail ? res.json(detail) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); }
  });
  app.post('/admin/properties/:id/units', requireManagement, async (req, res, next) => {
    try { const { id: propertyId } = uuidParam.parse(req.params); const input = unitCreateInput.parse(req.body); const property = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, (req as AuthenticatedRequest).authUser.organizationId))).limit(1); if (!property[0]) return res.status(404).json({ error: 'Resource not found.' }); const [unit] = await db.insert(units).values({ ...input, propertyId, bathrooms: input.bathrooms?.toFixed(2) }).returning(); return res.status(201).json(unit); } catch (error) { return next(error); }
  });
  app.patch('/admin/properties/:propertyId/units/:id', requireManagement, async (req, res, next) => {
    try { const { propertyId, id } = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() }).parse(req.params); const input = unitUpdateInput.parse(req.body); const owned = await db.select({ unitId: units.id }).from(units).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(units.id, id), eq(units.propertyId, propertyId), eq(properties.organizationId, (req as AuthenticatedRequest).authUser.organizationId))).limit(1); if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' }); const [unit] = await db.update(units).set({ ...input, bathrooms: input.bathrooms === undefined ? undefined : input.bathrooms === null ? null : input.bathrooms.toFixed(2), updatedAt: new Date() }).where(eq(units.id, id)).returning(); return unit ? res.json(unit) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); }
  });
  app.get('/admin/tenants', requireManagement, async (req, res, next) => {
    try { const organizationId = (req as AuthenticatedRequest).authUser.organizationId; return res.json(await db.select({ tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, lease: leases, unit: units, property: properties }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).leftJoin(leases, eq(leases.tenantId, tenants.id)).leftJoin(units, eq(units.id, leases.unitId)).leftJoin(properties, eq(properties.id, units.propertyId)).where(eq(tenants.organizationId, organizationId)).orderBy(asc(users.lastName), asc(users.firstName))); } catch (error) { return next(error); }
  });
  app.get('/admin/tenants/:id', requireManagement, async (req, res, next) => {
    try { const { id } = uuidParam.parse(req.params); const organizationId = (req as AuthenticatedRequest).authUser.organizationId; const tenantRows = await db.select({ tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(and(eq(tenants.id, id), eq(tenants.organizationId, organizationId))).limit(1); if (!tenantRows[0]) return res.status(404).json({ error: 'Resource not found.' }); const [leaseRows, requestRows] = await Promise.all([db.select({ lease: leases, unit: units, property: properties }).from(leases).innerJoin(units, eq(units.id, leases.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(eq(leases.tenantId, id)), db.select({ request: maintenanceRequests, unit: units, property: properties }).from(maintenanceRequests).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(eq(maintenanceRequests.tenantId, id))]); return res.json({ ...tenantRows[0], leases: leaseRows, maintenance: requestRows }); } catch (error) { return next(error); }
  });
  app.get('/admin/properties', requireManagement, async (req, res, next) => { try { const user = (req as AuthenticatedRequest).authUser; return res.json(await db.select().from(properties).where(eq(properties.organizationId, user.organizationId))); } catch (error) { return next(error); } });
  app.get('/admin/properties/new', requireManagement, (_req, res) => res.json({ route: '/admin/properties/new', method: 'POST' }));
  app.get('/admin/properties/:id', requireManagement, async (req, res, next) => { try { const id = idInput.parse(req.params.id); const user = (req as AuthenticatedRequest).authUser; const rows = await db.select().from(properties).where(and(eq(properties.id, id), eq(properties.organizationId, user.organizationId))).limit(1); return rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); } });
  app.get('/admin/tenants', requireManagement, async (req, res, next) => { try { const user = (req as AuthenticatedRequest).authUser; return res.json(await db.select().from(tenants).where(eq(tenants.organizationId, user.organizationId))); } catch (error) { return next(error); } });
  app.get('/admin/tenants/:id', requireManagement, async (req, res, next) => { try { const id = idInput.parse(req.params.id); const user = (req as AuthenticatedRequest).authUser; const rows = await db.select().from(tenants).where(and(eq(tenants.id, id), eq(tenants.organizationId, user.organizationId))).limit(1); return rows[0] ? res.json(rows[0]) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); } });
  app.get('/admin/maintenance', requireManagement, async (req, res, next) => {
    try {
      const user = (req as AuthenticatedRequest).authUser;
      const filter = req.query.status ? maintenanceFilterInput.parse(req.query.status) : undefined;
      const rows = await db.select({ request: maintenanceRequests, tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, unit: units, property: properties })
        .from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).innerJoin(users, eq(users.id, tenants.userId))
        .innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId))
        .where(and(eq(tenants.organizationId, user.organizationId), ...(filter ? [eq(maintenanceRequests.status, filter)] : [])))
        .orderBy(desc(maintenanceRequests.createdAt));
      return res.json(rows);
    } catch (error) { return next(error); }
  });
  app.get('/admin/maintenance/:id', requireManagement, async (req, res, next) => {
    try {
      const id = idInput.parse(req.params.id); const user = (req as AuthenticatedRequest).authUser;
      const rows = await db.select({ request: maintenanceRequests, tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, unit: units, property: properties })
        .from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).innerJoin(users, eq(users.id, tenants.userId))
        .innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId))
        .where(and(eq(maintenanceRequests.id, id), eq(tenants.organizationId, user.organizationId))).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Resource not found.' });
      return res.json({ ...rows[0], comments: await db.select({ comment: maintenanceComments, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(maintenanceComments).innerJoin(users, eq(users.id, maintenanceComments.userId)).where(eq(maintenanceComments.maintenanceRequestId, id)).orderBy(asc(maintenanceComments.createdAt)) });
    } catch (error) { return next(error); }
  });
  app.patch('/admin/maintenance/:id', requireManagement, async (req, res, next) => {
    try {
      const id = idInput.parse(req.params.id); const input = maintenanceStatusInput.parse(req.body); const user = (req as AuthenticatedRequest).authUser;
      const owned = await db.select({ request: maintenanceRequests }).from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).where(and(eq(maintenanceRequests.id, id), eq(tenants.organizationId, user.organizationId))).limit(1);
      if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' });
      const [updated] = await db.update(maintenanceRequests).set({ status: input.status, resolvedAt: input.status === 'RESOLVED' ? new Date() : null, updatedAt: new Date() }).where(eq(maintenanceRequests.id, id)).returning();
      return updated ? res.json(updated) : res.status(404).json({ error: 'Resource not found.' });
    } catch (error) { return next(error); }
  });
  app.post('/admin/maintenance/:id/comments', requireManagement, async (req, res, next) => {
    try {
      const id = idInput.parse(req.params.id); const input = maintenanceCommentInput.parse(req.body); const user = (req as AuthenticatedRequest).authUser;
      const owned = await db.select({ id: maintenanceRequests.id }).from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).where(and(eq(maintenanceRequests.id, id), eq(tenants.organizationId, user.organizationId))).limit(1);
      if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' });
      const [comment] = await db.insert(maintenanceComments).values({ maintenanceRequestId: id, userId: user.id, body: input.body }).returning();
      return res.status(201).json(comment);
    } catch (error) { return next(error); }
  });

  app.get('/tenant', requireTenant, (_req, res) => res.sendFile(`${clientRoot}/tenant.html`));
  app.get('/tenant/dashboard', requireTenant, async (req, res, next) => {
    try { const context = await getTenantContext(db, (req as AuthenticatedRequest).authUser.id); return context ? res.json(tenantDashboard(context)) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); }
  });
  app.get('/tenant/maintenance/new', requireTenant, (_req, res) => res.json({ route: '/tenant/maintenance/new', method: 'POST' }));
  app.post('/tenant/maintenance/new', requireTenant, async (req, res, next) => {
    try {
      const input = tenantMaintenanceInput.parse(req.body);
      const user = (req as AuthenticatedRequest).authUser;
      const tenant = await tenantForUser(db, user.id);
      if (!tenant) return res.status(404).json({ error: 'Resource not found.' });
      const unitRows = await db.select({ unit: units }).from(units).innerJoin(leases, eq(leases.unitId, units.id)).where(and(eq(leases.tenantId, tenant.id), eq(leases.status, 'ACTIVE'))).orderBy(desc(leases.startDate)).limit(1);
      if (!unitRows[0]) return res.status(404).json({ error: 'Resource not found.' });
      const [created] = await db.insert(maintenanceRequests).values({ tenantId: tenant.id, unitId: unitRows[0].unit.id, title: input.title, description: input.description, priority: input.priority }).returning();
      return res.status(201).json(created);
    } catch (error) { return next(error); }
  });
  app.get('/tenant/maintenance', requireTenant, async (req, res, next) => { try { const user = (req as AuthenticatedRequest).authUser; const tenant = await tenantForUser(db, user.id); if (!tenant) return res.status(404).json({ error: 'Resource not found.' }); return res.json(await db.select().from(maintenanceRequests).where(eq(maintenanceRequests.tenantId, tenant.id)).orderBy(desc(maintenanceRequests.createdAt))); } catch (error) { return next(error); } });
  app.get('/tenant/maintenance/:id', requireTenant, async (req, res, next) => { try { const id = idInput.parse(req.params.id); const user = (req as AuthenticatedRequest).authUser; const tenant = await tenantForUser(db, user.id); if (!tenant) return res.status(404).json({ error: 'Resource not found.' }); const rows = await db.select().from(maintenanceRequests).where(and(eq(maintenanceRequests.id, id), eq(maintenanceRequests.tenantId, tenant.id))).limit(1); if (!rows[0]) return res.status(404).json({ error: 'Resource not found.' }); return res.json({ request: rows[0], comments: await db.select({ comment: maintenanceComments, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(maintenanceComments).innerJoin(users, eq(users.id, maintenanceComments.userId)).where(eq(maintenanceComments.maintenanceRequestId, id)).orderBy(asc(maintenanceComments.createdAt)) }); } catch (error) { return next(error); } });
  app.post('/tenant/maintenance/:id/comments', requireTenant, async (req, res, next) => { try { const id = idInput.parse(req.params.id); const input = maintenanceCommentInput.parse(req.body); const user = (req as AuthenticatedRequest).authUser; const tenant = await tenantForUser(db, user.id); if (!tenant) return res.status(404).json({ error: 'Resource not found.' }); const owned = await db.select({ id: maintenanceRequests.id }).from(maintenanceRequests).where(and(eq(maintenanceRequests.id, id), eq(maintenanceRequests.tenantId, tenant.id))).limit(1); if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' }); const [comment] = await db.insert(maintenanceComments).values({ maintenanceRequestId: id, userId: user.id, body: input.body }).returning(); return res.status(201).json(comment); } catch (error) { return next(error); } });
  app.get('/tenant/lease', requireTenant, async (req, res, next) => { try { const context = await getTenantContext(db, (req as AuthenticatedRequest).authUser.id); return context ? res.json(context.leases) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); } });
  app.get('/tenant/documents', requireTenant, async (req, res, next) => { try { const result = await getTenantDocuments(db, (req as AuthenticatedRequest).authUser.id); return result ? res.json(result.documents) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); } });
  app.get('/tenant/profile', requireTenant, async (req, res, next) => { try { const context = await getTenantContext(db, (req as AuthenticatedRequest).authUser.id); return context ? res.json({ tenant: context.tenant, user: publicUser(context.user) }) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); } });
  app.patch('/tenant/profile', requireTenant, async (req, res, next) => { try { const input = tenantProfileUpdateInput.parse(req.body); const context = await getTenantContext(db, (req as AuthenticatedRequest).authUser.id); if (!context) return res.status(404).json({ error: 'Resource not found.' }); const [updated] = await db.update(tenants).set({ ...input, updatedAt: new Date() }).where(and(eq(tenants.id, context.tenant.id), eq(tenants.userId, (req as AuthenticatedRequest).authUser.id))).returning(); return updated ? res.json(updated) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); } });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request.' });
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    console.error(error);
    return res.status(500).json({ error: 'Internal server error.' });
  });
  return { app, pool };
}
async function tenantForUser(db: ReturnType<typeof createDb>['db'], userId: string) { const rows = await db.select().from(tenants).where(eq(tenants.userId, userId)).limit(1); return rows[0]; }
function publicUser(user: { id: string; organizationId: string; email: string; firstName: string; lastName: string; role: string }) { return { id: user.id, organizationId: user.organizationId, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }; }
