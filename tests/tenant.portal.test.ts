import { describe, expect, it } from 'vitest';
import { requireRole, requireSameTenantUser } from '../src/auth/authorization.js';
import { publicUser, tenantDashboard } from '../src/tenant/queries.js';
import { tenantMaintenanceInput, tenantProfileUpdateInput } from '../src/tenant/validation.js';

describe('tenant portal ownership policy', () => {
  it('allows only the authenticated tenant role into the tenant application', () => {
    expect(() => requireRole({ role: 'TENANT' } as never, 'TENANT')).not.toThrow();
    expect(() => requireRole({ role: 'MANAGER' } as never, 'TENANT')).toThrow();
    expect(() => requireSameTenantUser({ id: 'tenant-a', role: 'TENANT' } as never, 'tenant-b')).toThrow(/Resource not found/);
  });

  it('derives the dashboard from one tenant context without accepting a tenant id', () => {
    const context = {
      tenant: { id: 'tenant-a' },
      user: { id: 'user-a', firstName: 'Jamie' },
      leases: [{ lease: { id: 'lease-a', status: 'ACTIVE' }, unit: { unitNumber: '101' }, property: { name: 'Harborview' } }],
      lease: null,
      maintenance: [
        { request: { status: 'OPEN' }, unit: { unitNumber: '101' }, property: { name: 'Harborview' } },
        { request: { status: 'CLOSED' }, unit: { unitNumber: '101' }, property: { name: 'Harborview' } },
      ],
    } as never;
    const dashboard = tenantDashboard(context);
    expect(dashboard.tenant.id).toBe('tenant-a');
    expect(dashboard.openMaintenanceCount).toBe(1);
    expect(dashboard.recentMaintenance).toHaveLength(2);
  });

  it('validates only editable tenant contact fields', () => {
    expect(tenantProfileUpdateInput.parse({ phone: '555-0199', emergencyName: null, emergencyPhone: null })).toEqual({ phone: '555-0199', emergencyName: null, emergencyPhone: null });
    expect(() => tenantProfileUpdateInput.parse({ organizationId: 'other-org', phone: null, emergencyName: null, emergencyPhone: null })).toThrow();
  });

  it('accepts optional HTTP(S) maintenance photos and normalizes blank values', () => {
    expect(tenantMaintenanceInput.parse({ title: 'Leaking sink', description: 'Water under the cabinet', priority: 'HIGH', photoUrl: '  https://example.com/sink.jpg  ' })).toMatchObject({ photoUrl: 'https://example.com/sink.jpg' });
    expect(tenantMaintenanceInput.parse({ title: 'Leaking sink', description: 'Water under the cabinet', photoUrl: '' })).toMatchObject({ photoUrl: null });
    expect(() => tenantMaintenanceInput.parse({ title: 'Leaking sink', description: 'Water under the cabinet', photoUrl: 'ftp://example.com/sink.jpg' })).toThrow();
    expect(() => tenantMaintenanceInput.parse({ title: 'Leaking sink', description: 'Water under the cabinet', photoUrl: 'https://example.com/'.padEnd(2050, 'x') })).toThrow();
  });

  it('does not expose organization or password fields in public user responses', () => {
    const result = publicUser({ id: 'user-a', organizationId: 'org-a', email: 'tenant@example.test', firstName: 'Jamie', lastName: 'Rivera', role: 'TENANT', passwordHash: 'secret' } as never);
    expect(result).toEqual({ id: 'user-a', email: 'tenant@example.test', firstName: 'Jamie', lastName: 'Rivera', role: 'TENANT' });
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('organizationId');
  });
});
