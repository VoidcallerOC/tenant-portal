import { describe, expect, it } from 'vitest';
import { AuthError, requireAuthenticated, requireRole, requireSameTenantUser } from '../src/auth/authorization.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';

const admin = { id: 'admin', organizationId: 'org-a', role: 'ADMIN' } as never;
const manager = { id: 'manager', organizationId: 'org-a', role: 'MANAGER' } as never;
const tenantA = { id: 'tenant-user-a', organizationId: 'org-a', role: 'TENANT' } as never;

describe('authentication and authorization policy', () => {
  it('hashes passwords and verifies only the original secret', async () => {
    const hash = await hashPassword('CorrectHorseBattery!2026');
    expect(hash).not.toContain('CorrectHorseBattery');
    expect(await verifyPassword('CorrectHorseBattery!2026', hash)).toBe(true);
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('requires authentication and grants management roles only to admin or manager', () => {
    expect(() => requireAuthenticated(null)).toThrowError(new AuthError(401, 'Authentication required.'));
    expect(requireRole(admin, 'ADMIN', 'MANAGER')).toBe(admin);
    expect(requireRole(manager, 'ADMIN', 'MANAGER')).toBe(manager);
    expect(() => requireRole(tenantA, 'ADMIN', 'MANAGER')).toThrowError(new AuthError(403, 'You do not have permission to access this resource.'));
  });

  it('allows a tenant only their own identity and denies another tenant without leaking details', () => {
    expect(requireSameTenantUser(tenantA, 'tenant-user-a')).toBe(tenantA);
    expect(() => requireSameTenantUser(tenantA, 'tenant-user-b')).toThrowError(new AuthError(404, 'Resource not found.'));
    expect(() => requireRole(admin, 'TENANT')).toThrowError(new AuthError(403, 'You do not have permission to access this resource.'));
  });
});
