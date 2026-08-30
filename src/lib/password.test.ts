import { expect, test } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

test('hashPassword returns a bcrypt modular crypt hash', async () => {
  const hash = await hashPassword('correct horse');
  expect(hash).toMatch(/^\$2[aby]?\$/);
});

test('verifyPassword returns true for the correct password', async () => {
  const hash = await hashPassword('correct horse');
  expect(await verifyPassword('correct horse', hash)).toBe(true);
});

test('verifyPassword returns false for the wrong password', async () => {
  const hash = await hashPassword('correct horse');
  expect(await verifyPassword('wrong', hash)).toBe(false);
});
