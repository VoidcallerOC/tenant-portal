import { describe, expect, it } from 'vitest';
import { organizationAccess } from '../src/db/access.js';
import { leaseInput, organizationInput, propertyInput } from '../src/validation.js';

describe('foundation validation', () => {
  it('accepts valid organization and property inputs', () => {
    expect(organizationInput.parse({ name: 'Harborview', slug: 'harborview' }).slug).toBe('harborview');
    expect(propertyInput.parse({ name: 'Lofts', addressLine1: '1 Main St', city: 'Portland', state: 'ME', zip: '04101' }).state).toBe('ME');
  });

  it('rejects invalid slugs and backwards leases', () => {
    expect(() => organizationInput.parse({ name: 'Bad', slug: 'Not Valid' })).toThrow();
    expect(() => leaseInput.parse({ tenantId: '00000000-0000-4000-8000-000000000001', unitId: '00000000-0000-4000-8000-000000000002', startDate: '2026-05-02', endDate: '2026-05-01', monthlyRent: 1000 })).toThrow(/endDate/);
  });
});

describe('organization access boundary', () => {
  it('requires an organization id before constructing helpers', () => {
    expect(() => organizationAccess({} as never, '')).toThrow(/organizationId is required/);
  });

  it('adds a scoped where clause to read helpers', () => {
    const whereCalls: unknown[] = [];
    const db = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => { whereCalls.push(condition); return Promise.resolve([]); },
        }),
      }),
    };
    const access = organizationAccess(db as never, '00000000-0000-4000-8000-000000000001');
    void access.listProperties();
    expect(whereCalls).toHaveLength(1);
  });
});
