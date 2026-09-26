import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { seal, unseal, crypt } from '../vault.mjs';
test('encrypted process transfer detects tampering', () => {
  const key = randomBytes(32), packed = seal(Buffer.from('test only'), key);
  assert.equal(unseal(packed, key).toString(), 'test only');
  packed[20] ^= 1;
  assert.throws(() => unseal(packed, key), /Invalid protected transfer/);
});
test('Windows encrypts and decrypts Unicode credentials without plaintext files', { skip: process.platform !== 'win32' }, () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'twitch-ig-vault-test-'));
  try {
    const value = JSON.stringify({ test: 'Not a credential — ✓' });
    const encrypted = crypt(root, temp, 'protect', value);
    assert.ok(!encrypted.includes('Not a credential'));
    assert.equal(crypt(root, temp, 'unprotect', encrypted), value);
    assert.deepEqual(fs.readdirSync(temp), []);
  } finally { fs.rmdirSync(temp); }
});
