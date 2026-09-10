import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { documents, leases, maintenanceRequests, properties, tenants, units, users } from '../db/schema.js';

export async function getTenantContext(db: Db, userId: string) {
  const tenantRows = await db.select({ tenant: tenants, user: users }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(and(eq(tenants.userId, userId), eq(tenants.organizationId, users.organizationId))).limit(1);
  const identity = tenantRows[0];
  if (!identity) return null;
  const leaseRows = await db.select({ lease: leases, unit: units, property: properties }).from(leases).innerJoin(units, eq(units.id, leases.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(leases.tenantId, identity.tenant.id), eq(properties.organizationId, identity.tenant.organizationId))).orderBy(desc(leases.startDate));
  const requestRows = await db.select({ request: maintenanceRequests, unit: units, property: properties }).from(maintenanceRequests).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId)).where(and(eq(maintenanceRequests.tenantId, identity.tenant.id), eq(properties.organizationId, identity.tenant.organizationId))).orderBy(desc(maintenanceRequests.createdAt));
  return { ...identity, lease: leaseRows[0] ?? null, leases: leaseRows, maintenance: requestRows };
}

export async function getTenantDocuments(db: Db, userId: string) {
  const context = await getTenantContext(db, userId);
  if (!context) return null;
  const leaseIds = context.leases.map(({ lease }) => lease.id);
  if (!leaseIds.length) return { tenant: context.tenant, documents: [] };
  const owned = await db.select().from(documents).where(and(eq(documents.organizationId, context.tenant.organizationId), eq(documents.tenantId, context.tenant.id), inArray(documents.leaseId, leaseIds)));
  return { tenant: context.tenant, documents: owned };
}

export function tenantDashboard(context: NonNullable<Awaited<ReturnType<typeof getTenantContext>>>) {
  const activeLease = context.leases.find(({ lease }) => lease.status === 'ACTIVE') ?? context.lease;
  return { tenant: context.tenant, user: publicUser(context.user), lease: activeLease, openMaintenanceCount: context.maintenance.filter(({ request }) => request.status === 'OPEN' || request.status === 'IN_PROGRESS').length, recentMaintenance: context.maintenance.slice(0, 5) };
}

export function publicUser(user: Pick<typeof users.$inferSelect, 'id' | 'organizationId' | 'email' | 'firstName' | 'lastName' | 'role'>) {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role };
}
