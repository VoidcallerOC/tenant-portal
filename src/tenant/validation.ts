import { z } from 'zod';

export const tenantProfileUpdateInput = z.object({
  phone: z.string().trim().max(40).nullable(),
  emergencyName: z.string().trim().max(160).nullable(),
  emergencyPhone: z.string().trim().max(40).nullable(),
}).strict();
