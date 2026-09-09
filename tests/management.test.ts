import { describe, expect, it } from 'vitest';
import { propertyCreateInput, unitCreateInput, unitUpdateInput } from '../src/management/validation.js';
import { requireRole } from '../src/auth/authorization.js';

describe('management CRUD validation', () => {
  it('accepts and normalizes a property payload', () => {
    const property = propertyCreateInput.parse({ name: 'Juniper Court', addressLine1: '22 Juniper Avenue', city: 'Portland', state: 'me', zip: '04103' });
    expect(property.state).toBe('ME');
    expect(property.name).toBe('Juniper Court');
  });

  it('rejects incomplete properties and invalid unit status', () => {
    expect(() => propertyCreateInput.parse({ name: 'Missing address' })).toThrow();
    expect(() => unitCreateInput.parse({ unitNumber: '1A', status: 'UNKNOWN' })).toThrow();
  });

  it('supports partial unit updates without allowing arbitrary fields', () => {
    expect(unitUpdateInput.parse({ status: 'MAINTENANCE' })).toEqual({ status: 'MAINTENANCE' });
    expect(() => unitUpdateInput.parse({ organizationId: 'other-org' })).toThrow();
  });
});

describe('management authorization', () => {
  it('permits both management roles and rejects tenants', () => {
    expect(() => requireRole({ role: 'ADMIN' } as never, 'ADMIN', 'MANAGER')).not.toThrow();
    expect(() => requireRole({ role: 'MANAGER' } as never, 'ADMIN', 'MANAGER')).not.toThrow();
    expect(() => requireRole({ role: 'TENANT' } as never, 'ADMIN', 'MANAGER')).toThrow();
  });
});
