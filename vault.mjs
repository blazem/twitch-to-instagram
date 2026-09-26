import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID, createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';
export function seal(bytes, key) {
  const iv = randomBytes(16), cipher = createCipheriv('aes-256-cbc', key, iv);
  const payload = Buffer.concat([iv, cipher.update(bytes), cipher.final()]);
  return Buffer.concat([payload, createHmac('sha256', key).update(payload).digest()]);
}
export function unseal(bytes, key) {
  if (bytes.length < 64) throw new Error('Invalid protected transfer.');
  const payload = bytes.subarray(0, -32), tag = bytes.subarray(-32);
  if (!timingSafeEqual(tag, createHmac('sha256', key).update(payload).digest())) throw new Error('Invalid protected transfer.');
  const cipher = createDecipheriv('aes-256-cbc', key, payload.subarray(0, 16));
  return Buffer.concat([cipher.update(payload.subarray(16)), cipher.final()]);
}
export function crypt(root, privateDir, mode, value) {
  const key = randomBytes(32), id = randomUUID();
  const input = path.join(privateDir, `${id}.input`), output = path.join(privateDir, `${id}.output`);
  const powershell = path.join(process.env.ProgramFiles || 'C:/Program Files', 'PowerShell/7/pwsh.exe');
  try {
    // Temporary files are encrypted too. The one-use transfer key exists only in process memory/environment.
    fs.writeFileSync(input, mode === 'protect' ? seal(Buffer.from(value), key) : value);
    const r = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-File', path.join(root, 'secrets.ps1'), mode, input, output], { stdio: 'ignore', windowsHide: true, env: { ...process.env, TWITCH_IG_SESSION_KEY: key.toString('base64') }, timeout: 15000 });
    if (r.status !== 0) throw new Error('Windows could not unlock the saved settings. Use the same Windows account that saved them.');
    return mode === 'protect' ? fs.readFileSync(output, 'utf8').trim() : unseal(fs.readFileSync(output), key).toString('utf8');
  } finally { key.fill(0); for (const f of [input, output]) if (fs.existsSync(f)) fs.unlinkSync(f); }
}
