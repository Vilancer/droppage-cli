import bcrypt from 'bcryptjs';

/** bcrypt cost factor (security domain: cost factor 10). */
export const BCRYPT_ROUNDS = 10;

/** Hash a plaintext password with bcryptjs. */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/** Verify a plaintext password against a bcrypt hash. */
export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
