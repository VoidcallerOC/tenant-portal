import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error('Passwords must be at least 12 characters.');
  const salt = randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, KEY_LENGTH) as Buffer;
  return `${SCRYPT_PREFIX}$${salt}$${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [prefix, salt, expectedHex] = encoded.split('$');
  if (prefix !== SCRYPT_PREFIX || !salt || !expectedHex || !/^[0-9a-f]+$/i.test(expectedHex)) return false;
  try {
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = await scrypt(password, salt, expected.length) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
