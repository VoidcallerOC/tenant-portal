import { z } from 'zod';

export const propertyCreateInput = z.object({
  name: z.string().trim().min(1).max(160),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  zip: z.string().trim().min(5).max(10),
}).strict();

export const unitCreateInput = z.object({
  unitNumber: z.string().trim().min(1).max(40),
  bedrooms: z.coerce.number().int().nonnegative().max(99).nullable().optional(),
  bathrooms: z.coerce.number().positive().max(99).nullable().optional(),
  status: z.enum(['VACANT', 'OCCUPIED', 'MAINTENANCE']).default('VACANT'),
}).strict();

export const unitUpdateInput = unitCreateInput.partial();
export const uuidParam = z.object({ id: z.string().uuid() });

export type PropertyCreateInput = z.infer<typeof propertyCreateInput>;
export type UnitCreateInput = z.infer<typeof unitCreateInput>;
export type UnitUpdateInput = z.infer<typeof unitUpdateInput>;
