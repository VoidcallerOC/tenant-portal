import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { createDb } from './client.js';
import { organizations, users, properties, units, tenants, leases, charges, maintenanceRequests } from './schema.js';
import { hashPassword } from '../auth/password.js';

const ids = {
  organization: '00000000-0000-4000-8000-000000000001',
  admin: '00000000-0000-4000-8000-000000000002',
  manager: '00000000-0000-4000-8000-000000000003',
  tenantAUser: '00000000-0000-4000-8000-000000000004',
  tenantBUser: '00000000-0000-4000-8000-000000000005',
  propertyA: '00000000-0000-4000-8000-000000000010',
  propertyB: '00000000-0000-4000-8000-000000000011',
  unitA1: '00000000-0000-4000-8000-000000000020',
  unitA2: '00000000-0000-4000-8000-000000000021',
  unitB1: '00000000-0000-4000-8000-000000000022',
  tenantA: '00000000-0000-4000-8000-000000000030',
  tenantB: '00000000-0000-4000-8000-000000000031',
  leaseA: '00000000-0000-4000-8000-000000000040',
  leaseB: '00000000-0000-4000-8000-000000000041',
  requestA: '00000000-0000-4000-8000-000000000050',
  requestB: '00000000-0000-4000-8000-000000000051',
} as const;

const { db, pool } = createDb();
try {
  const [adminPasswordHash, managerPasswordHash, tenantAPasswordHash, tenantBPasswordHash] = await Promise.all([
    hashPassword('AdminDemoPassword!2026'),
    hashPassword('ManagerDemoPassword!2026'),
    hashPassword('TenantDemoPassword!2026'),
    hashPassword('TenantTwoDemoPassword!2026'),
  ]);
  await db.transaction(async (tx) => {
    await tx.insert(organizations).values({ id: ids.organization, name: 'Test Property Group', slug: 'test', email: 'ops@test.example', phone: '555-0100' }).onConflictDoNothing();
    await tx.insert(users).values([
      { id: ids.admin, organizationId: ids.organization, email: 'admin@test.example', firstName: 'Avery', lastName: 'Stone', role: 'ADMIN', passwordHash: adminPasswordHash },
      { id: ids.manager, organizationId: ids.organization, email: 'manager@test.example', firstName: 'Morgan', lastName: 'Lee', role: 'MANAGER', passwordHash: managerPasswordHash },
      { id: ids.tenantAUser, organizationId: ids.organization, email: 'jamie@example.test', firstName: 'Jamie', lastName: 'Rivera', role: 'TENANT', passwordHash: tenantAPasswordHash },
      { id: ids.tenantBUser, organizationId: ids.organization, email: 'riley@example.test', firstName: 'Riley', lastName: 'Chen', role: 'TENANT', passwordHash: tenantBPasswordHash },
    ]).onConflictDoNothing();
    await tx.update(users).set({ passwordHash: adminPasswordHash }).where(eq(users.id, ids.admin));
    await tx.update(users).set({ passwordHash: managerPasswordHash }).where(eq(users.id, ids.manager));
    await tx.update(users).set({ passwordHash: tenantAPasswordHash }).where(eq(users.id, ids.tenantAUser));
    await tx.update(users).set({ passwordHash: tenantBPasswordHash }).where(eq(users.id, ids.tenantBUser));
    await tx.insert(properties).values([
      { id: ids.propertyA, organizationId: ids.organization, name: 'Test Lofts', addressLine1: '101 Water Street', city: 'Portland', state: 'ME', zip: '04101' },
      { id: ids.propertyB, organizationId: ids.organization, name: 'Juniper Court', addressLine1: '22 Juniper Avenue', city: 'Portland', state: 'ME', zip: '04103' },
    ]).onConflictDoNothing();
    await tx.insert(units).values([
      { id: ids.unitA1, propertyId: ids.propertyA, unitNumber: '101', bedrooms: 1, bathrooms: '1.00', status: 'OCCUPIED' },
      { id: ids.unitA2, propertyId: ids.propertyA, unitNumber: '202', bedrooms: 2, bathrooms: '1.50', status: 'VACANT' },
      { id: ids.unitB1, propertyId: ids.propertyB, unitNumber: '3B', bedrooms: 2, bathrooms: '1.00', status: 'OCCUPIED' },
    ]).onConflictDoNothing();
    await tx.insert(tenants).values([
      { id: ids.tenantA, userId: ids.tenantAUser, organizationId: ids.organization, phone: '555-0111', emergencyName: 'Sam Rivera', emergencyPhone: '555-0112' },
      { id: ids.tenantB, userId: ids.tenantBUser, organizationId: ids.organization, phone: '555-0121' },
    ]).onConflictDoNothing();
    await tx.insert(leases).values([
      { id: ids.leaseA, tenantId: ids.tenantA, unitId: ids.unitA1, startDate: '2026-01-01', monthlyRent: '1850.00', securityDeposit: '1850.00', status: 'ACTIVE' },
      { id: ids.leaseB, tenantId: ids.tenantB, unitId: ids.unitB1, startDate: '2026-03-01', monthlyRent: '2100.00', securityDeposit: '2100.00', status: 'ACTIVE' },
    ]).onConflictDoNothing();
    const now = new Date();
    const periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
    const activeLeases = await tx.select({ lease: leases, tenant: tenants }).from(leases).innerJoin(tenants, eq(tenants.id, leases.tenantId)).where(eq(leases.status, 'ACTIVE'));
    if (activeLeases.length) await tx.insert(charges).values(activeLeases.map(({ lease, tenant }) => ({ organizationId: tenant.organizationId, tenantId: tenant.id, leaseId: lease.id, periodStart, amount: lease.monthlyRent, status: 'DUE' as const }))).onConflictDoNothing({ target: [charges.leaseId, charges.periodStart] });
    await tx.insert(maintenanceRequests).values([
      { id: ids.requestA, tenantId: ids.tenantA, unitId: ids.unitA1, title: 'Kitchen faucet drips', description: 'The faucet continues to drip after the handle is closed.', priority: 'LOW', status: 'OPEN' },
      { id: ids.requestB, tenantId: ids.tenantB, unitId: ids.unitB1, title: 'Heating is intermittent', description: 'The heat cycles off unexpectedly overnight.', priority: 'HIGH', status: 'IN_PROGRESS' },
    ]).onConflictDoNothing();
  });
  console.log('Development seed data inserted.');
} finally {
  await pool.end();
}
