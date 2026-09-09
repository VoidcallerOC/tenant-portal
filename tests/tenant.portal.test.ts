import { describe, expect, it } from 'vitest';
import { requireRole, requireSameTenantUser } from '../src/auth/authorization.js';
import { tenantDashboard } from '../src/tenant/queries.js';
import { tenantProfileUpdateInput } from '../src/tenant/validation.js';

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
});
