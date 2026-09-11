import Stripe from 'stripe';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { charges, leases, properties, tenants, units, users } from '../db/schema.js';

export type ChargeEventMetadata = {
  chargeId: string;
  organizationId: string;
  tenantId: string;
  leaseId: string;
  periodStart: string;
};

let stripeClient: Stripe | undefined;
export function stripe() {
  if (!stripeClient) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('Stripe is not configured.');
    stripeClient = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripeClient;
}

export function currentPeriodStart(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function dueDateForPeriod(startDate: string, periodStart: string) {
  const day = Number(startDate.slice(8, 10)) || 1;
  const parts = periodStart.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${periodStart.slice(0, 8)}${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

function amountInCents(amount: string) {
  const cents = Math.round(Number(amount) * 100);
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('Lease rent must be a positive amount.');
  return cents;
}

function billingUrls() {
  const base = process.env.PUBLIC_APP_URL;
  if (!base) throw new Error('PUBLIC_APP_URL is required for Stripe Checkout.');
  return {
    success_url: process.env.STRIPE_SUCCESS_URL ?? `${base}/tenant#payments`,
    cancel_url: process.env.STRIPE_CANCEL_URL ?? `${base}/tenant#payments`,
  };
}

async function currentTenantLease(db: Db, userId: string) {
  const rows = await db.select({ tenant: tenants, user: users, lease: leases, unit: units, property: properties })
    .from(tenants)
    .innerJoin(users, eq(users.id, tenants.userId))
    .innerJoin(leases, eq(leases.tenantId, tenants.id))
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(tenants.userId, userId), eq(tenants.organizationId, users.organizationId), eq(leases.status, 'ACTIVE'), eq(properties.organizationId, tenants.organizationId)))
    .orderBy(desc(leases.startDate))
    .limit(1);
  return rows[0] ?? null;
}

export async function createTenantCheckoutSession(db: Db, userId: string) {
  const context = await currentTenantLease(db, userId);
  if (!context) return { kind: 'not_found' as const };
  const periodStart = currentPeriodStart();
  const existingRows = await db.select().from(charges).where(and(eq(charges.organizationId, context.tenant.organizationId), eq(charges.tenantId, context.tenant.id), eq(charges.leaseId, context.lease.id), eq(charges.periodStart, periodStart))).limit(1);
  let charge = existingRows[0];
  if (!charge) {
    const inserted = await db.insert(charges).values({ organizationId: context.tenant.organizationId, tenantId: context.tenant.id, leaseId: context.lease.id, periodStart, amount: context.lease.monthlyRent, status: 'DUE' }).onConflictDoNothing({ target: [charges.leaseId, charges.periodStart] }).returning();
    charge = inserted[0] ?? (await db.select().from(charges).where(and(eq(charges.organizationId, context.tenant.organizationId), eq(charges.tenantId, context.tenant.id), eq(charges.leaseId, context.lease.id), eq(charges.periodStart, periodStart))).limit(1))[0];
  }
  if (!charge) throw new Error('Unable to create rent charge.');
  if (charge.status === 'PAID') return { kind: 'paid' as const, charge };
  const client = stripe();
  if (charge.status === 'OPEN' && charge.stripeCheckoutSessionId) {
    const existing = await client.checkout.sessions.retrieve(charge.stripeCheckoutSessionId);
    if (existing.status === 'open' && existing.url) return { kind: 'checkout' as const, charge, url: existing.url };
    await db.update(charges).set({ status: 'VOID', updatedAt: new Date() }).where(and(eq(charges.id, charge.id), eq(charges.organizationId, context.tenant.organizationId)));
  }
  const metadata: ChargeEventMetadata = { chargeId: charge.id, organizationId: context.tenant.organizationId, tenantId: context.tenant.id, leaseId: context.lease.id, periodStart };
  const session = await client.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card', 'us_bank_account'],
    customer_email: context.user.email,
    client_reference_id: charge.id,
    line_items: [{ price_data: { currency: 'usd', unit_amount: amountInCents(context.lease.monthlyRent), product_data: { name: `Rent for ${periodStart.slice(0, 7)}` } }, quantity: 1 }],
    metadata,
    payment_intent_data: { metadata },
    ...billingUrls(),
  });
  const [updated] = await db.update(charges).set({ status: 'OPEN', stripeCheckoutSessionId: session.id, updatedAt: new Date() }).where(and(eq(charges.id, charge.id), eq(charges.organizationId, context.tenant.organizationId), eq(charges.tenantId, context.tenant.id), eq(charges.leaseId, context.lease.id))).returning();
  return { kind: 'checkout' as const, charge: updated ?? charge, url: session.url };
}

export async function listTenantCharges(db: Db, userId: string) {
  const rows = await db.select({ charge: charges, lease: leases, property: properties, unit: units })
    .from(charges)
    .innerJoin(tenants, eq(tenants.id, charges.tenantId))
    .innerJoin(users, eq(users.id, tenants.userId))
    .innerJoin(leases, eq(leases.id, charges.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(charges.tenantId, tenants.id), eq(tenants.userId, userId), eq(charges.organizationId, tenants.organizationId), eq(properties.organizationId, tenants.organizationId)))
    .orderBy(desc(charges.periodStart), desc(charges.createdAt));
  return rows.map((row) => ({ ...row, dueDate: dueDateForPeriod(row.lease.startDate, row.charge.periodStart) }));
}

export async function listOrganizationCharges(db: Db, organizationId: string) {
  const rows = await db.select({ charge: charges, tenant: tenants, user: { firstName: users.firstName, lastName: users.lastName, email: users.email }, lease: leases, property: properties, unit: units })
    .from(charges)
    .innerJoin(tenants, eq(tenants.id, charges.tenantId))
    .innerJoin(users, eq(users.id, tenants.userId))
    .innerJoin(leases, eq(leases.id, charges.leaseId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(charges.organizationId, organizationId), eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId), eq(properties.organizationId, organizationId)))
    .orderBy(desc(charges.periodStart), asc(users.lastName), asc(users.firstName));
  return rows.map((row) => ({ ...row, dueDate: dueDateForPeriod(row.lease.startDate, row.charge.periodStart) }));
}

export async function applyStripeChargeEvent(db: Db, metadata: ChargeEventMetadata, status: 'PAID' | 'FAILED' | 'VOID', paymentIntentId?: string | null) {
  const values = status === 'PAID' ? { status, paidAt: new Date(), stripePaymentIntentId: paymentIntentId ?? undefined, updatedAt: new Date() } : { status, updatedAt: new Date() };
  const [updated] = await db.update(charges).set(values).where(and(eq(charges.id, metadata.chargeId), eq(charges.organizationId, metadata.organizationId), eq(charges.tenantId, metadata.tenantId), eq(charges.leaseId, metadata.leaseId), eq(charges.periodStart, metadata.periodStart))).returning();
  return updated;
}
