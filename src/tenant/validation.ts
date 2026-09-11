import { z } from 'zod';
import { uploadPayload } from '../files.js';

export const tenantMaintenanceInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(10_000),
  photoUrl: z.preprocess((value) => typeof value === 'string' && !value.trim() ? null : value, z.string().trim().max(2_048).url().refine((value) => /^https?:\/\//i.test(value), 'Photo URL must use http or https.').nullable().optional()),
  photo: uploadPayload.optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']).default('MEDIUM'),
}).strict();

export const tenantProfileUpdateInput = z.object({
  phone: z.string().trim().max(40).nullable(),
  emergencyName: z.string().trim().max(160).nullable(),
  emergencyPhone: z.string().trim().max(40).nullable(),
}).strict();
