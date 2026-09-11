import { z } from 'zod';

export const MAX_UPLOAD_BYTES = 2_000_000;

export const uploadPayload = z.object({
  name: z.string().trim().min(1).max(200),
  mime: z.string().trim().min(1).max(120),
  data: z.string().min(1),
}).strict();

const photoMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const documentMimes = new Set([...photoMimes, 'application/pdf', 'text/plain', 'image/heic']);

export function decodeUpload(input: z.infer<typeof uploadPayload>, kind: 'photo' | 'document') {
  const mime = input.mime.toLowerCase();
  const allowed = kind === 'photo' ? photoMimes : documentMimes;
  if (!allowed.has(mime)) throw Object.assign(new Error('That file type is not allowed.'), { status: 400 });
  const raw = input.data.includes(',') ? input.data.slice(input.data.indexOf(',') + 1) : input.data;
  let bytes: Buffer;
  try { bytes = Buffer.from(raw, 'base64'); } catch { throw Object.assign(new Error('Invalid file data.'), { status: 400 }); }
  if (!bytes.length) throw Object.assign(new Error('File is empty.'), { status: 400 });
  if (bytes.length > MAX_UPLOAD_BYTES) throw Object.assign(new Error('File must be 2 MB or smaller.'), { status: 400 });
  return { name: input.name, mime, bytes };
}

export function publicFileUrl(id: string) {
  return `/files/${id}`;
}
