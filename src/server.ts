import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { and, asc, desc, eq, or } from 'drizzle-orm';
import Stripe from 'stripe';
import { createDb } from './db/client.js';
import { charges, documents, leases, maintenanceComments, maintenanceRequests, properties, tenants, units, usageCharges, users } from './db/schema.js';
import { AuthError, requireAuthenticated, requireRole } from './auth/authorization.js';
import { hashPassword } from './auth/password.js';
import { authenticate, createSession, getUserForSession, revokeSession, SESSION_COOKIE } from './auth/service.js';
import { getDashboard, getPropertyDetail, listProperties } from './management/queries.js';
import { leaseCreateInput, propertyCreateInput, propertyUpdateInput, tenantCreateInput, unitCreateInput, unitUpdateInput, usageCreateInput, uuidParam } from './management/validation.js';
import { getTenantContext, getTenantDocuments, tenantDashboard } from './tenant/queries.js';
import { tenantMaintenanceInput, tenantProfileUpdateInput } from './tenant/validation.js';
import { applyStripeChargeEvent, createTenantCheckoutSession, listOrganizationCharges, listTenantCharges, stripe } from './payments/service.js';
import { IMPORT_MAX_BYTES, commitImport, errorReportCsv, listImportHistory, normalizeRows, parseSpreadsheet, previewImport, suggestMapping, type ColumnMapping, type PreviewRecord } from './importer/service.js';

const loginInput = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).strict();
const idInput = z.string().uuid();
const maintenanceCommentInput = z.object({ body: z.string().trim().min(1).max(5_000) }).strict();
const maintenanceStatusInput = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']) }).strict();
const maintenanceFilterInput = z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']);
const tenantChargeCheckoutInput = z.object({ chargeId: z.string().uuid().optional() }).strict();
const chargeStatusInput = z.enum(['DUE', 'OPEN', 'PAID', 'FAILED', 'VOID']);
const importerUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_BYTES, files: 1 } });
const pendingImports = new Map<string, { organizationId: string; userId: string; fileName: string; headers: string[]; rows: Record<string, string>[]; mapping: ColumnMapping; preview: PreviewRecord[]; createdAt: number }>();
type AuthenticatedRequest = Request & { authUser: NonNullable<Awaited<ReturnType<typeof getUserForSession>>> };

function readCookie(req: Request, name: string) {
  const pair = req.headers.cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  if (!pair) return undefined;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return undefined; }
}
function serializeSessionCookie(value: string, expires: Date) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires.toUTCString()}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function sendAuthError(error: unknown, res: Response, next: NextFunction) {
  if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
  return next(error);
}
function isUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === '23505';
}
function importCounts(records: PreviewRecord[]) {
  return { rows: records.length, properties: new Set(records.filter((record) => record.property).map((record) => record.property!.name.toLowerCase())).size, units: new Set(records.filter((record) => record.unit).map((record) => record.unit!.unitNumber.toLowerCase())).size, tenants: new Set(records.filter((record) => record.tenant).map((record) => record.tenant!.email || `${record.tenant!.firstName} ${record.tenant!.lastName}`)).size, leases: records.filter((record) => record.lease).length, new: records.filter((record) => record.classification === 'NEW').length, existing: records.filter((record) => record.classification === 'EXISTING').length, updates: records.filter((record) => record.classification === 'UPDATE').length, review: records.filter((record) => record.classification === 'REVIEW').length, skipped: records.filter((record) => record.classification === 'SKIP').length };
}

export function createApp(databaseUrl?: string) {
  const { db, pool } = createDb(databaseUrl);
  const app = express();
  app.disable('x-powered-by');
  const clientRoot = fileURLToPath(new URL('../client/', import.meta.url));
  app.use(express.static(clientRoot, { index: false }));

  app.post('/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !process.env.STRIPE_WEBHOOK_SECRET) return res.status(400).send('Webhook signature is required.');
    let event: Stripe.Event;
    try { event = stripe().webhooks.constructEvent(req.body as Buffer, signature, process.env.STRIPE_WEBHOOK_SECRET); } catch { return res.status(400).send('Invalid webhook signature.'); }
    try {
      const object = event.data.object as Stripe.Checkout.Session | Stripe.PaymentIntent;
      const metadata = object.metadata as Record<string, string> | null | undefined;
      const chargeMetadata = metadata?.chargeId && metadata.organizationId && metadata.tenantId && metadata.leaseId && metadata.periodStart
        ? { chargeId: metadata.chargeId, organizationId: metadata.organizationId, tenantId: metadata.tenantId, leaseId: metadata.leaseId, periodStart: metadata.periodStart }
        : undefined;
      if (event.type === 'checkout.session.completed') {
        const session = object as Stripe.Checkout.Session;
        if (session.payment_status === 'paid') await applyStripeChargeEvent(db, { metadata: chargeMetadata, sessionId: session.id }, 'PAID', typeof session.payment_intent === 'string' ? session.payment_intent : null);
      } else if (event.type === 'payment_intent.succeeded') {
        const paymentIntent = object as Stripe.PaymentIntent;
        await applyStripeChargeEvent(db, { metadata: chargeMetadata, sessionId: undefined }, 'PAID', paymentIntent.id);
      } else if (event.type === 'checkout.session.async_payment_succeeded') {
        const session = object as Stripe.Checkout.Session;
        await applyStripeChargeEvent(db, { metadata: chargeMetadata, sessionId: session.id }, 'PAID', typeof session.payment_intent === 'string' ? session.payment_intent : null);
      } else if (event.type === 'checkout.session.async_payment_failed' || event.type === 'payment_intent.payment_failed') {
        const sessionId = event.type === 'checkout.session.async_payment_failed' ? (object as Stripe.Checkout.Session).id : undefined;
        await applyStripeChargeEvent(db, { metadata: chargeMetadata, sessionId }, 'FAILED', null);
      } else if (event.type === 'checkout.session.expired') {
        await applyStripeChargeEvent(db, { metadata: chargeMetadata, sessionId: (object as Stripe.Checkout.Session).id }, 'VOID', null);
      }
      return res.json({ received: true });
    } catch (error) { console.error(error); return res.status(500).json({ error: 'Webhook processing failed.' }); }
  });

  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_req, res) => res.redirect('/login'));
  app.get('/login', (_req, res) => res.sendFile(`${clientRoot}/login.html`));
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
  const requireManager = (req: Request, res: Response, next: NextFunction) => { try { requireRole((req as AuthenticatedRequest).authUser, 'MANAGER'); return next(); } catch (error) { return sendAuthError(error, res, next); } };
  const requireTenant = (req: Request, res: Response, next: NextFunction) => { try { requireRole((req as AuthenticatedRequest).authUser, 'TENANT'); return next(); } catch (error) { return sendAuthError(error, res, next); } };
  const requireAnyAuth = (req: Request, res: Response, next: NextFunction) => { try { requireAuthenticated((req as AuthenticatedRequest).authUser); return next(); } catch (error) { return sendAuthError(error, res, next); } };

  app.post('/admin/imports/upload', requireManagement, importerUpload.single('file'), async (req, res, next) => {
    try {
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Choose a CSV, XLSX, or XLS file.' });
      const parsed = parseSpreadsheet(file.buffer, file.originalname);
      const suggested = suggestMapping(parsed.headers);
      const preview = await previewImport(db, (req as AuthenticatedRequest).authUser.organizationId, normalizeRows(parsed.rows, suggested.mapping));
      const token = randomUUID();
      pendingImports.set(token, { organizationId: (req as AuthenticatedRequest).authUser.organizationId, userId: (req as AuthenticatedRequest).authUser.id, fileName: file.originalname, headers: parsed.headers, rows: parsed.rows, mapping: suggested.mapping, preview, createdAt: Date.now() });
      return res.status(201).json({ token, fileName: file.originalname, fileSize: file.size, sheets: parsed.sheets, headers: parsed.headers, mapping: suggested.mapping, suggestions: suggested.suggestions, preview, counts: importCounts(preview) });
    } catch (error) { return next(error); }
  });
  app.post('/admin/imports/preview', requireManagement, async (req, res, next) => {
    try {
      const input = z.object({ token: z.string().uuid(), mapping: z.record(z.string(), z.string()) }).strict().parse(req.body);
      const draft = pendingImports.get(input.token); const user = (req as AuthenticatedRequest).authUser;
      if (!draft || draft.organizationId !== user.organizationId || draft.userId !== user.id || Date.now() - draft.createdAt > 30 * 60 * 1000) return res.status(404).json({ error: 'Import preview expired. Upload the file again.' });
      draft.mapping = input.mapping; draft.preview = await previewImport(db, user.organizationId, normalizeRows(draft.rows, draft.mapping));
      return res.json({ preview: draft.preview, counts: importCounts(draft.preview), mapping: draft.mapping });
    } catch (error) { return next(error); }
  });
  app.post('/admin/imports/confirm', requireManagement, async (req, res, next) => {
    try {
      const input = z.object({ token: z.string().uuid(), skipRows: z.array(z.number().int().positive()).default([]) }).strict().parse(req.body);
      const draft = pendingImports.get(input.token); const user = (req as AuthenticatedRequest).authUser;
      if (!draft || draft.organizationId !== user.organizationId || draft.userId !== user.id || Date.now() - draft.createdAt > 30 * 60 * 1000) return res.status(404).json({ error: 'Import preview expired. Upload the file again.' });
      draft.preview = draft.preview.map((record) => input.skipRows.includes(record.rowNumber) ? { ...record, classification: 'SKIP' } : record);
      const result = await commitImport(db, user.organizationId, user.id, draft.fileName, draft.preview); pendingImports.delete(input.token); return res.json({ result });
    } catch (error) { return next(error); }
  });
  app.get('/admin/imports/history', requireManagement, async (req, res, next) => { try { return res.json(await listImportHistory(db, (req as AuthenticatedRequest).authUser.organizationId)); } catch (error) { return next(error); } });
  app.get('/admin/imports/report/:token', requireManagement, (req, res, next) => { try { const token = idInput.parse(req.params.token); const draft = pendingImports.get(token); const user = (req as AuthenticatedRequest).authUser; if (!draft || draft.organizationId !== user.organizationId) return res.status(404).send('Import report not found.'); res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="import-review-${token}.csv"`).send(errorReportCsv(draft.preview)); } catch (error) { return next(error); } });

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
  app.get('/admin/charges', requireManagement, async (req, res, next) => {
    try { const status = req.query.status === undefined ? undefined : chargeStatusInput.parse(req.query.status); return res.json(await listOrganizationCharges(db, (req as AuthenticatedRequest).authUser.organizationId, status)); } catch (error) { return next(error); }
  });
  app.post('/admin/charges/:id/void', requireManager, async (req, res, next) => {
    try {
      const id = uuidParam.parse(req.params).id;
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const [updated] = await db.update(charges).set({ status: 'VOID', updatedAt: new Date() }).where(and(eq(charges.id, id), eq(charges.organizationId, organizationId), or(eq(charges.status, 'DUE'), eq(charges.status, 'OPEN')))).returning();
      return updated ? res.json(updated) : res.status(404).json({ error: 'Charge not found or not voidable.' });
    } catch (error) { return next(error); }
  });
  app.get('/admin/overuse', requireManagement, async (req, res, next) => {
    try {
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const rows = await db.select({ usage: usageCharges, user: { firstName: users.firstName, lastName: users.lastName, email: users.email }, unit: units, property: properties })
        .from(usageCharges).innerJoin(tenants, eq(tenants.id, usageCharges.tenantId)).innerJoin(users, eq(users.id, tenants.userId)).innerJoin(units, eq(units.id, usageCharges.unitId)).innerJoin(properties, eq(properties.id, usageCharges.propertyId))
        .where(and(eq(usageCharges.organizationId, organizationId), eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId), eq(properties.organizationId, organizationId))).orderBy(desc(usageCharges.periodStart), desc(usageCharges.createdAt));
      return res.json(rows);
    } catch (error) { return next(error); }
  });
  app.post('/admin/overuse', requireManagement, async (req, res, next) => {
    try {
      const input = usageCreateInput.parse(req.body);
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const leaseRows = await db.select({ lease: leases, tenant: tenants, unit: units, property: properties }).from(leases)
        .innerJoin(tenants, eq(tenants.id, leases.tenantId)).innerJoin(units, eq(units.id, leases.unitId)).innerJoin(properties, eq(properties.id, units.propertyId))
        .where(and(eq(leases.tenantId, input.tenantId), eq(leases.unitId, input.unitId), eq(leases.status, 'ACTIVE'), eq(tenants.organizationId, organizationId), eq(properties.organizationId, organizationId))).limit(1);
      const assignment = leaseRows[0];
      if (!assignment) return res.status(404).json({ error: 'No active lease found for this resident and unit.' });
      const overageAmount = Number(((input.actualUsage - input.allowance) * input.unitRate).toFixed(2));
      const [usage] = await db.insert(usageCharges).values({ organizationId, tenantId: input.tenantId, leaseId: assignment.lease.id, unitId: input.unitId, propertyId: assignment.property.id, category: input.category, periodStart: input.periodStart, allowance: input.allowance.toFixed(3), actualUsage: input.actualUsage.toFixed(3), unitRate: input.unitRate.toFixed(2), overageAmount: overageAmount.toFixed(2) }).returning();
      return res.status(201).json(usage);
    } catch (error) { if (isUniqueViolation(error)) return res.status(409).json({ error: 'An overuse record already exists for this resident, category, and period.' }); return next(error); }
  });
  app.patch('/admin/overuse/:id', requireManagement, async (req, res, next) => {
    try {
      const { id } = uuidParam.parse(req.params);
      const status = z.object({ status: z.enum(['PAID', 'WAIVED', 'DUE']) }).strict().parse(req.body).status;
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const [updated] = await db.update(usageCharges).set({ status, paidAt: status === 'PAID' ? new Date() : null, updatedAt: new Date() }).where(and(eq(usageCharges.id, id), eq(usageCharges.organizationId, organizationId))).returning();
      return updated ? res.json(updated) : res.status(404).json({ error: 'Overuse record not found.' });
    } catch (error) { return next(error); }
  });
  app.get('/admin', requireManagement, (_req, res) => res.sendFile(`${clientRoot}/admin.html`));
  app.get('/admin/properties/new', requireManagement, (_req, res) => res.sendFile(`${clientRoot}/admin.html`));
  app.post('/admin/properties', requireManagement, async (req, res, next) => {
    try { const input = propertyCreateInput.parse(req.body); const [property] = await db.insert(properties).values({ ...input, monthlyRent: input.monthlyRent == null ? null : input.monthlyRent.toFixed(2), organizationId: (req as AuthenticatedRequest).authUser.organizationId }).returning(); return res.status(201).json(property); } catch (error) { return next(error); }
  });
  app.get('/admin/properties', requireManagement, async (req, res, next) => {
    try { return res.json(await listProperties(db, (req as AuthenticatedRequest).authUser.organizationId)); } catch (error) { return next(error); }
  });
  app.get('/admin/properties/:id', requireManagement, async (req, res, next) => {
    try { const { id } = uuidParam.parse(req.params); const detail = await getPropertyDetail(db, (req as AuthenticatedRequest).authUser.organizationId, id); return detail ? res.json(detail) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); }
  });
  app.patch('/admin/properties/:id', requireManagement, async (req, res, next) => {
    try {
      const { id } = uuidParam.parse(req.params);
      const input = propertyUpdateInput.parse(req.body);
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const [updated] = await db.update(properties).set({ ...input, monthlyRent: input.monthlyRent === undefined ? undefined : input.monthlyRent == null ? null : input.monthlyRent.toFixed(2), updatedAt: new Date() }).where(and(eq(properties.id, id), eq(properties.organizationId, organizationId))).returning();
      return updated ? res.json(updated) : res.status(404).json({ error: 'Resource not found.' });
    } catch (error) { return next(error); }
  });
  app.post('/admin/properties/:id/units', requireManagement, async (req, res, next) => {
    try { const { id: propertyId } = uuidParam.parse(req.params); const input = unitCreateInput.parse(req.body); const property = await db.select({ id: properties.id }).from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, (req as AuthenticatedRequest).authUser.organizationId))).limit(1); if (!property[0]) return res.status(404).json({ error: 'Resource not found.' }); const [unit] = await db.insert(units).values({ ...input, propertyId, bathrooms: input.bathrooms?.toFixed(2) }).returning(); return res.status(201).json(unit); } catch (error) { return next(error); }
  });
  app.patch('/admin/properties/:propertyId/units/:id', requireManagement, async (req, res, next) => {
    try { const { propertyId, id } = z.object({ propertyId: z.string().uuid(), id: z.string().uuid() }).parse(req.params); const input = unitUpdateInput.parse(req.body); const owned = await db.select({ unitId: units.id }).from(units).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(units.id, id), eq(units.propertyId, propertyId), eq(properties.organizationId, (req as AuthenticatedRequest).authUser.organizationId))).limit(1); if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' }); const [unit] = await db.update(units).set({ ...input, bathrooms: input.bathrooms === undefined ? undefined : input.bathrooms === null ? null : input.bathrooms.toFixed(2), updatedAt: new Date() }).where(eq(units.id, id)).returning(); return unit ? res.json(unit) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); }
  });
  app.get('/admin/tenants', requireManagement, async (req, res, next) => {
    try { const organizationId = (req as AuthenticatedRequest).authUser.organizationId; return res.json(await db.select({ tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, lease: leases, unit: units, property: properties }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).leftJoin(leases, eq(leases.tenantId, tenants.id)).leftJoin(units, eq(units.id, leases.unitId)).leftJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId))).orderBy(asc(users.lastName), asc(users.firstName))); } catch (error) { return next(error); }
  });
  app.get('/admin/tenants/:id', requireManagement, async (req, res, next) => {
    try { const { id } = uuidParam.parse(req.params); const organizationId = (req as AuthenticatedRequest).authUser.organizationId; const tenantRows = await db.select({ tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(and(eq(tenants.id, id), eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId))).limit(1); if (!tenantRows[0]) return res.status(404).json({ error: 'Resource not found.' }); const [leaseRows, requestRows] = await Promise.all([db.select({ lease: leases, unit: units, property: properties }).from(leases).innerJoin(units, eq(units.id, leases.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(leases.tenantId, id), eq(properties.organizationId, organizationId))), db.select({ request: maintenanceRequests, unit: units, property: properties }).from(maintenanceRequests).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(maintenanceRequests.tenantId, id), eq(properties.organizationId, organizationId)))]); return res.json({ ...tenantRows[0], leases: leaseRows, maintenance: requestRows }); } catch (error) { return next(error); }
  });
  app.post('/admin/tenants', requireManagement, async (req, res, next) => {
    try {
      const input = tenantCreateInput.parse(req.body);
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const result = await db.transaction(async (tx) => {
        const [user] = await tx.insert(users).values({ organizationId, email: input.email.toLowerCase(), passwordHash: await hashPassword(input.password), firstName: input.firstName, lastName: input.lastName, role: 'TENANT' }).returning({ id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role });
        if (!user) throw new Error('Unable to create tenant user.');
        const [tenant] = await tx.insert(tenants).values({ userId: user.id, organizationId, phone: input.phone, emergencyName: input.emergencyName, emergencyPhone: input.emergencyPhone }).returning();
        if (!tenant) throw new Error('Unable to create tenant record.');
        return { tenant, user };
      });
      return res.status(201).json(result);
    } catch (error) {
      if (isUniqueViolation(error)) return res.status(409).json({ error: 'A tenant account with this email already exists.' });
      return next(error);
    }
  });
  app.get('/admin/lease-options', requireManagement, async (req, res, next) => {
    try {
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const [tenantRows, unitRows] = await Promise.all([
        db.select({ id: tenants.id, firstName: users.firstName, lastName: users.lastName, email: users.email }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(and(eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId), eq(users.role, 'TENANT'))).orderBy(asc(users.lastName), asc(users.firstName)),
        db.select({ id: units.id, unitNumber: units.unitNumber, propertyId: properties.id, propertyName: properties.name }).from(units).innerJoin(properties, eq(properties.id, units.propertyId)).where(eq(properties.organizationId, organizationId)).orderBy(asc(properties.name), asc(units.unitNumber)),
      ]);
      return res.json({ tenants: tenantRows, units: unitRows });
    } catch (error) { return next(error); }
  });
  app.post('/admin/tenants/:id/lease', requireManagement, async (req, res, next) => {
    try {
      const tenantId = uuidParam.parse(req.params).id;
      const input = leaseCreateInput.parse(req.body);
      const organizationId = (req as AuthenticatedRequest).authUser.organizationId;
      const tenantRows = await db.select({ id: tenants.id }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(and(eq(tenants.id, tenantId), eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId), eq(users.role, 'TENANT'))).limit(1);
      if (!tenantRows[0]) return res.status(404).json({ error: 'Tenant not found.' });
      const unitRows = await db.select({ id: units.id }).from(units).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(units.id, input.unitId), eq(properties.organizationId, organizationId))).limit(1);
      if (!unitRows[0]) return res.status(404).json({ error: 'Unit not found.' });
      const existing = await db.select({ id: leases.id }).from(leases).where(and(eq(leases.tenantId, tenantId), eq(leases.status, 'ACTIVE'))).limit(1);
      if (existing[0] && input.status === 'ACTIVE') return res.status(409).json({ error: 'Tenant already has an active lease.' });
      const occupied = await db.select({ id: leases.id }).from(leases).where(and(eq(leases.unitId, input.unitId), eq(leases.status, 'ACTIVE'))).limit(1);
      if (occupied[0] && input.status === 'ACTIVE') return res.status(409).json({ error: 'Unit already has an active lease.' });
      const result = await db.transaction(async (tx) => {
        const [lease] = await tx.insert(leases).values({ tenantId, unitId: input.unitId, startDate: input.startDate.toISOString().slice(0, 10), endDate: input.endDate ? input.endDate.toISOString().slice(0, 10) : null, monthlyRent: input.monthlyRent.toFixed(2), securityDeposit: input.securityDeposit === undefined || input.securityDeposit === null ? null : input.securityDeposit.toFixed(2), status: input.status }).returning();
        if (!lease) throw new Error('Unable to create lease.');
        if (input.status === 'ACTIVE') await tx.update(units).set({ status: 'OCCUPIED', updatedAt: new Date() }).where(eq(units.id, input.unitId));
        return lease;
      });
      return res.status(201).json(result);
    } catch (error) { return next(error); }
  });
  app.get('/admin/maintenance', requireManagement, async (req, res, next) => {
    try {
      const user = (req as AuthenticatedRequest).authUser;
      const filter = req.query.status ? maintenanceFilterInput.parse(req.query.status) : undefined;
      const rows = await db.select({ request: maintenanceRequests, tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, unit: units, property: properties })
        .from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).innerJoin(users, eq(users.id, tenants.userId))
        .innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId))
        .where(and(eq(tenants.organizationId, user.organizationId), eq(users.organizationId, user.organizationId), eq(properties.organizationId, user.organizationId), ...(filter ? [eq(maintenanceRequests.status, filter)] : [])))
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
        .where(and(eq(maintenanceRequests.id, id), eq(tenants.organizationId, user.organizationId), eq(users.organizationId, user.organizationId), eq(properties.organizationId, user.organizationId))).limit(1);
      if (!rows[0]) return res.status(404).json({ error: 'Resource not found.' });
      return res.json({ ...rows[0], comments: await db.select({ comment: maintenanceComments, user: { id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(maintenanceComments).innerJoin(users, eq(users.id, maintenanceComments.userId)).where(and(eq(maintenanceComments.maintenanceRequestId, id), eq(users.organizationId, user.organizationId))).orderBy(asc(maintenanceComments.createdAt)) });
    } catch (error) { return next(error); }
  });
  app.patch('/admin/maintenance/:id', requireManagement, async (req, res, next) => {
    try {
      const id = idInput.parse(req.params.id); const input = maintenanceStatusInput.parse(req.body); const user = (req as AuthenticatedRequest).authUser;
      const owned = await db.select({ request: maintenanceRequests }).from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(maintenanceRequests.id, id), eq(tenants.organizationId, user.organizationId), eq(properties.organizationId, user.organizationId))).limit(1);
      if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' });
      const updated = await db.transaction(async (tx) => {
        const [request] = await tx.update(maintenanceRequests).set({ status: input.status, resolvedAt: input.status === 'RESOLVED' ? new Date() : null, updatedAt: new Date() }).where(eq(maintenanceRequests.id, id)).returning();
        if (!request) return undefined;
        await tx.insert(maintenanceComments).values({ maintenanceRequestId: id, userId: user.id, body: `${user.firstName} ${user.lastName} marked this ${input.status}.` });
        return request;
      });
      return updated ? res.json(updated) : res.status(404).json({ error: 'Resource not found.' });
    } catch (error) { return next(error); }
  });
  app.post('/admin/maintenance/:id/comments', requireManagement, async (req, res, next) => {
    try {
      const id = idInput.parse(req.params.id); const input = maintenanceCommentInput.parse(req.body); const user = (req as AuthenticatedRequest).authUser;
      const owned = await db.select({ id: maintenanceRequests.id }).from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(maintenanceRequests.id, id), eq(tenants.organizationId, user.organizationId), eq(properties.organizationId, user.organizationId))).limit(1);
      if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' });
      const [comment] = await db.insert(maintenanceComments).values({ maintenanceRequestId: id, userId: user.id, body: input.body }).returning();
      return res.status(201).json(comment);
    } catch (error) { return next(error); }
  });

  app.get('/tenant', requireTenant, (_req, res) => res.sendFile(`${clientRoot}/tenant.html`));
  app.get('/tenant/charges', requireTenant, async (req, res, next) => {
    try { return res.json(await listTenantCharges(db, (req as AuthenticatedRequest).authUser.id)); } catch (error) { return next(error); }
  });
  app.post('/tenant/charges/checkout', requireTenant, async (req, res, next) => {
    try {
      const input = tenantChargeCheckoutInput.parse(req.body ?? {});
      const result = await createTenantCheckoutSession(db, (req as AuthenticatedRequest).authUser.id, input.chargeId);
      if (result.kind === 'not_found') return res.status(404).json({ error: 'Resource not found.' });
      if (result.kind === 'paid' || result.kind === 'not_payable') return res.status(409).json({ error: 'This charge is not payable.' });
      if (!result.url) return res.status(503).json({ error: 'Stripe Checkout is unavailable.' });
      return res.json({ url: result.url });
    } catch (error) { return next(error); }
  });
  app.get('/tenant/dashboard', requireTenant, async (req, res, next) => {
    try { const context = await getTenantContext(db, (req as AuthenticatedRequest).authUser.id); return context ? res.json(tenantDashboard(context)) : res.status(404).json({ error: 'Resource not found.' }); } catch (error) { return next(error); }
  });
  app.post('/tenant/maintenance/new', requireTenant, async (req, res, next) => {
    try {
      const input = tenantMaintenanceInput.parse(req.body);
      const user = (req as AuthenticatedRequest).authUser;
      const tenant = await tenantForUser(db, user.id);
      if (!tenant) return res.status(404).json({ error: 'Resource not found.' });
      const unitRows = await db.select({ unit: units }).from(units).innerJoin(leases, eq(leases.unitId, units.id)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(leases.tenantId, tenant.id), eq(leases.status, 'ACTIVE'), eq(properties.organizationId, tenant.organizationId))).orderBy(desc(leases.startDate)).limit(1);
      if (!unitRows[0]) return res.status(409).json({ error: 'An active lease is required to submit a maintenance request.' });
      const [created] = await db.insert(maintenanceRequests).values({ tenantId: tenant.id, unitId: unitRows[0].unit.id, title: input.title, description: input.description, photoUrl: input.photoUrl ?? null, priority: input.priority }).returning();
      return res.status(201).json(created);
    } catch (error) { return next(error); }
  });
  app.get('/tenant/maintenance', requireTenant, async (req, res, next) => { try { const user = (req as AuthenticatedRequest).authUser; const tenant = await tenantForUser(db, user.id); if (!tenant) return res.status(404).json({ error: 'Resource not found.' }); return res.json(await db.select({ request: maintenanceRequests }).from(maintenanceRequests).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(maintenanceRequests.tenantId, tenant.id), eq(properties.organizationId, tenant.organizationId))).orderBy(desc(maintenanceRequests.createdAt)).then(rows => rows.map(row => row.request))); } catch (error) { return next(error); } });
  app.get('/tenant/maintenance/:id', requireTenant, async (req, res, next) => { try { const id = idInput.parse(req.params.id); const user = (req as AuthenticatedRequest).authUser; const tenant = await tenantForUser(db, user.id); if (!tenant) return res.status(404).json({ error: 'Resource not found.' }); const rows = await db.select({ request: maintenanceRequests }).from(maintenanceRequests).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(maintenanceRequests.id, id), eq(maintenanceRequests.tenantId, tenant.id), eq(properties.organizationId, tenant.organizationId))).limit(1); if (!rows[0]) return res.status(404).json({ error: 'Resource not found.' }); return res.json({ request: rows[0].request, comments: await db.select({ comment: maintenanceComments, user: { id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(maintenanceComments).innerJoin(users, eq(users.id, maintenanceComments.userId)).where(and(eq(maintenanceComments.maintenanceRequestId, id), eq(users.organizationId, tenant.organizationId))).orderBy(asc(maintenanceComments.createdAt)) }); } catch (error) { return next(error); } });
  app.post('/tenant/maintenance/:id/comments', requireTenant, async (req, res, next) => { try { const id = idInput.parse(req.params.id); const input = maintenanceCommentInput.parse(req.body); const user = (req as AuthenticatedRequest).authUser; const tenant = await tenantForUser(db, user.id); if (!tenant) return res.status(404).json({ error: 'Resource not found.' }); const owned = await db.select({ id: maintenanceRequests.id }).from(maintenanceRequests).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(maintenanceRequests.id, id), eq(maintenanceRequests.tenantId, tenant.id), eq(properties.organizationId, tenant.organizationId))).limit(1); if (!owned[0]) return res.status(404).json({ error: 'Resource not found.' }); const [comment] = await db.insert(maintenanceComments).values({ maintenanceRequestId: id, userId: user.id, body: input.body }).returning(); return res.status(201).json(comment); } catch (error) { return next(error); } });
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
async function tenantForUser(db: ReturnType<typeof createDb>['db'], userId: string) { const rows = await db.select({ tenant: tenants }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(and(eq(tenants.userId, userId), eq(tenants.organizationId, users.organizationId))).limit(1); return rows[0]?.tenant; }
function publicUser(user: { id: string; email: string; firstName: string; lastName: string; role: string }) { return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role }; }

let vercelApp: ReturnType<typeof createApp>['app'] | undefined;
let vercelInitializationError: unknown;

export default function vercelHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (vercelInitializationError) throw vercelInitializationError;
    vercelApp ??= createApp().app;
    return vercelApp(req, res, next);
  } catch (error) {
    vercelInitializationError = error;
    console.error(error);
    if (error instanceof Error && error.message === 'DATABASE_URL is required to connect to the database.') {
      return res.status(503).json({ error: 'Database configuration is required.' });
    }
    return res.status(500).json({ error: 'Application initialization failed.' });
  }
}
