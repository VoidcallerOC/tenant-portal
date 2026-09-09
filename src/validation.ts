import { z } from 'zod';

const nullableTrimmed = z.string().trim().min(1).nullable().optional();

export const organizationInput = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  email: z.string().email().nullable().optional(),
  phone: nullableTrimmed,
});

export const propertyInput = z.object({
  name: z.string().trim().min(1).max(160),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: nullableTrimmed,
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2).toUpperCase(),
  zip: z.string().trim().min(5).max(10),
});

export const maintenanceRequestInput = z.object({
  tenantId: z.string().uuid(),
  unitId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10_000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']).default('MEDIUM'),
});

export const leaseInput = z.object({
  tenantId: z.string().uuid(),
  unitId: z.string().uuid(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  monthlyRent: z.coerce.number().positive().finite(),
  securityDeposit: z.coerce.number().nonnegative().finite().nullable().optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'PENDING', 'TERMINATED']).default('PENDING'),
}).refine((value) => !value.endDate || value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});

export type OrganizationInput = z.infer<typeof organizationInput>;
export type PropertyInput = z.infer<typeof propertyInput>;
export type MaintenanceRequestInput = z.infer<typeof maintenanceRequestInput>;
export type LeaseInput = z.infer<typeof leaseInput>;
