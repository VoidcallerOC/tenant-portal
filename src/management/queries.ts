import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { leases, maintenanceRequests, properties, tenants, units, users } from '../db/schema.js';

export async function getDashboard(db: Db, organizationId: string) {
  const [propertyRows, unitRows, tenantRows, openRequestRows, recentRequests, recentTenants] = await Promise.all([
    db.select().from(properties).where(eq(properties.organizationId, organizationId)),
    db.select({ unit: units }).from(units).innerJoin(properties, eq(properties.id, units.propertyId)).where(eq(properties.organizationId, organizationId)),
    db.select({ tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(eq(tenants.organizationId, organizationId)),
    db.select({ request: maintenanceRequests }).from(maintenanceRequests).innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).where(and(eq(tenants.organizationId, organizationId), inArray(maintenanceRequests.status, ['OPEN', 'IN_PROGRESS']))),
    db.select({ request: maintenanceRequests, tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, unit: units, property: properties }).from(maintenanceRequests)
      .innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).innerJoin(users, eq(users.id, tenants.userId))
      .innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId))
      .where(and(eq(tenants.organizationId, organizationId), eq(properties.organizationId, organizationId))).orderBy(desc(maintenanceRequests.createdAt)).limit(5),
    db.select({ tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role } }).from(tenants).innerJoin(users, eq(users.id, tenants.userId)).where(eq(tenants.organizationId, organizationId)).orderBy(desc(tenants.createdAt)).limit(5),
  ]);

  const occupied = unitRows.filter(({ unit }) => unit.status === 'OCCUPIED').length;
  const vacant = unitRows.filter(({ unit }) => unit.status === 'VACANT').length;
  const activeTenantRows = await db.select({ tenantId: leases.tenantId }).from(leases).innerJoin(tenants, eq(tenants.id, leases.tenantId)).where(and(eq(tenants.organizationId, organizationId), eq(leases.status, 'ACTIVE')));
  const activeTenantIds = new Set(activeTenantRows.map((row) => row.tenantId));

  return {
    stats: { properties: propertyRows.length, units: unitRows.length, occupied, vacant, activeTenants: activeTenantIds.size, openMaintenance: openRequestRows.length },
    recentRequests,
    recentTenants,
    propertyOverview: propertyRows.map((property) => {
      const propertyUnits = unitRows.filter(({ unit }) => unit.propertyId === property.id).map(({ unit }) => unit);
      return { property, unitCount: propertyUnits.length, occupied: propertyUnits.filter((unit) => unit.status === 'OCCUPIED').length, vacant: propertyUnits.filter((unit) => unit.status === 'VACANT').length, maintenance: propertyUnits.filter((unit) => unit.status === 'MAINTENANCE').length };
    }),
  };
}

export async function listProperties(db: Db, organizationId: string) {
  const rows = await db.select({ property: properties, unit: units }).from(properties).leftJoin(units, eq(units.propertyId, properties.id)).where(eq(properties.organizationId, organizationId)).orderBy(asc(properties.name));
  return groupProperties(rows);
}

export async function getPropertyDetail(db: Db, organizationId: string, propertyId: string) {
  const propertyRows = await db.select().from(properties).where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId))).limit(1);
  const property = propertyRows[0];
  if (!property) return null;
  const propertyUnits = await db.select().from(units).where(eq(units.propertyId, propertyId)).orderBy(asc(units.unitNumber));
  const tenantsForProperty = await db.select({ tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, lease: leases, unit: units }).from(leases)
    .innerJoin(tenants, eq(tenants.id, leases.tenantId)).innerJoin(users, eq(users.id, tenants.userId)).innerJoin(units, eq(units.id, leases.unitId))
    .where(and(eq(units.propertyId, propertyId), eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId)));
    const requests = await db.select({ request: maintenanceRequests, tenant: tenants, user: { id: users.id, organizationId: users.organizationId, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role }, unit: units }).from(maintenanceRequests)
    .innerJoin(tenants, eq(tenants.id, maintenanceRequests.tenantId)).innerJoin(users, eq(users.id, tenants.userId)).innerJoin(units, eq(units.id, maintenanceRequests.unitId)).innerJoin(properties, eq(properties.id, units.propertyId))
    .where(and(eq(units.propertyId, propertyId), eq(tenants.organizationId, organizationId), eq(users.organizationId, organizationId), eq(properties.organizationId, organizationId))).orderBy(desc(maintenanceRequests.createdAt));
  return { property, units: propertyUnits, tenants: tenantsForProperty, maintenance: requests };
}

function groupProperties(rows: Array<{ property: typeof properties.$inferSelect; unit: typeof units.$inferSelect | null }>) {
  return rows.reduce<Array<{ property: typeof properties.$inferSelect; units: Array<typeof units.$inferSelect> }>>((result, row) => {
    let entry = result.find((candidate) => candidate.property.id === row.property.id);
    if (!entry) { entry = { property: row.property, units: [] }; result.push(entry); }
    if (row.unit) entry.units.push(row.unit);
    return result;
  }, []).map(({ property, units: propertyUnits }) => ({ property, units: propertyUnits, unitCount: propertyUnits.length, occupied: propertyUnits.filter((unit) => unit.status === 'OCCUPIED').length, vacant: propertyUnits.filter((unit) => unit.status === 'VACANT').length, maintenance: propertyUnits.filter((unit) => unit.status === 'MAINTENANCE').length }));
}
