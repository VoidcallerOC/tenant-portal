import { z } from 'zod';

export const propertyCreateInput = z.object({
  name: z.string().trim().min(1).max(160),
  monthlyRent: z.preprocess((value) => value === '' || value === undefined ? null : value, z.coerce.number().nonnegative().finite().nullable().optional()),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  zip: z.string().trim().min(5).max(10),
}).strict();

export const tenantCreateInput = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(200),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  phone: z.string().trim().max(40).nullable().optional(),
  emergencyName: z.string().trim().max(160).nullable().optional(),
  emergencyPhone: z.string().trim().max(40).nullable().optional(),
}).strict();

export const leaseCreateInput = z.object({
  unitId: z.string().uuid(),
  startDate: z.coerce.date(),
  endDate: z.preprocess((value) => value === '' || value === undefined ? null : value, z.coerce.date().nullable()),
  monthlyRent: z.coerce.number().positive().finite(),
  securityDeposit: z.coerce.number().nonnegative().finite().nullable().optional(),
  status: z.enum(['ACTIVE', 'EXPIRED', 'PENDING', 'TERMINATED']).default('ACTIVE'),
}).strict().refine((value) => !value.endDate || value.endDate >= value.startDate, {
  message: 'endDate must be on or after startDate',
  path: ['endDate'],
});

export const unitCreateInput = z.object({
  unitNumber: z.string().trim().min(1).max(40),
  bedrooms: z.coerce.number().int().nonnegative().max(99).nullable().optional(),
  bathrooms: z.coerce.number().positive().max(99).nullable().optional(),
  status: z.enum(['VACANT', 'OCCUPIED', 'MAINTENANCE']).default('VACANT'),
}).strict();

export const propertyUpdateInput = propertyCreateInput.partial();
export const unitUpdateInput = unitCreateInput.partial();
export const uuidParam = z.object({ id: z.string().uuid() });

export type PropertyCreateInput = z.infer<typeof propertyCreateInput>;
export type TenantCreateInput = z.infer<typeof tenantCreateInput>;
export type LeaseCreateInput = z.infer<typeof leaseCreateInput>;
export type UnitCreateInput = z.infer<typeof unitCreateInput>;
export type UnitUpdateInput = z.infer<typeof unitUpdateInput>;
