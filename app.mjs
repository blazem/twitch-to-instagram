import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { crypt as vaultCrypt } from './vault.mjs';
import { Obs, photoSize, twitch, graph, cloudinary, cloudUsage, required, waitUntilReady, duplicateDecision } from './core.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE = path.join(ROOT, '.private');
fs.mkdirSync(PRIVATE, { recursive: true });
const CONFIG = path.join(PRIVATE, 'settings.dpapi');
const STATE = path.join(PRIVATE, 'history.json');
const PORT = 17863;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const defaults = { twitchChannel: '', instagramLogin: 'instagram', apiVersion: 'v24.0', armed: false };
const publicKeys = ['twitchChannel', 'twitchClientId', 'cloudName', 'instagramId', 'instagramLogin', 'apiVersion', 'armed'];
const secretKeys = ['twitchClientSecret', 'cloudKey', 'cloudSecret', 'instagramToken'];
function crypt(mode, value) {
  return vaultCrypt(ROOT, PRIVATE, mode, value);
}
function atomic(file, value) { const tmp = `${file}.${randomUUID()}.tmp`; fs.writeFileSync(tmp, value); fs.renameSync(tmp, file); }
let cachedConfig;
function config() {
  if (!cachedConfig) cachedConfig = fs.existsSync(CONFIG) ? { ...defaults, ...JSON.parse(crypt('unprotect', fs.readFileSync(CONFIG, 'utf8'))) } : { ...defaults };
  return { ...cachedConfig };
}
function saveConfig(c) { atomic(CONFIG, crypt('protect', JSON.stringify(c))); cachedConfig = { ...c }; }
function history() { return fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : { streams: {}, assets: [] }; }
function saveHistory(h) { atomic(STATE, JSON.stringify(h, null, 2)); }
function obsConfig() {
  const file = path.join(process.env.APPDATA, 'obs-studio/plugin_config/obs-websocket/config.json');
  if (!fs.existsSync(file)) throw new Error('OBS WebSocket settings were not found. Open OBS and enable Tools → WebSocket Server Settings.');
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!c.server_enabled) throw new Error('Enable the WebSocket server in OBS → Tools → WebSocket Server Settings.');
  return c;
}
let status = { busy: false, message: 'Ready for setup. Nothing has been posted.', image: false, caption: '', account: '' };
let busy = false;
async function capture(requireLive = false) {
  const obs = new Obs();
  try {
    await obs.connect(obsConfig());
    if (requireLive && !(await obs.call('GetStreamStatus')).outputActive) throw new Error('OBS is not streaming. Nothing was posted.');
    const scene = await obs.call('GetCurrentProgramScene');
    const studio = await obs.call('GetStudioModeEnabled');
    if (studio.studioModeEnabled) {
      const preview = await obs.call('GetCurrentPreviewScene');
      if (preview.currentPreviewSceneName === scene.currentProgramSceneName) throw new Error('OBS Studio Mode has the same scene in Preview and Program. Switch Preview to another scene or turn Studio Mode off so the screenshot matches the broadcast.');
    }
    const video = await obs.call('GetVideoSettings');
    const size = photoSize(video.baseWidth, video.baseHeight);
    const image = await obs.call('GetSourceScreenshot', { sourceName: scene.currentProgramSceneName, imageFormat: 'jpg', imageCompressionQuality: 88, ...size });
    const match = /^data:image\/(?:jpg|jpeg);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(image.imageData || '');
    if (!match) throw new Error('OBS did not return a JPEG screenshot.');
    const bytes = Buffer.from(match[1], 'base64');
    if (bytes.length > 8 * 1024 * 1024) throw new Error('The screenshot exceeds Instagram’s 8 MB photo limit.');
    atomic(path.join(PRIVATE, 'preview.jpg'), bytes);
    status.image = true;
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } finally { obs.close(); }
}
async function exclusive(fn) {
  if (busy) throw new Error('A request is already running. Please wait.');
  busy = true; status.busy = true;
  try { return await fn(); }
  catch (e) { status.message = e.message; throw e; }
  finally { busy = false; status.busy = false; }
}
function update(message) { status.message = message; }
async function checkConnections(c) {
  required(c, ['twitchClientId', 'twitchClientSecret', 'cloudName', 'cloudKey', 'cloudSecret', 'instagramToken', 'instagramId']);
  update('Checking Twitch and Instagram (no uploads or posts)…');
  const stream = await twitch(c);
  const account = await graph(c, c.instagramId, { fields: 'id,username' });
  const usage = await cloudUsage(c);
  status.caption = stream.title; status.account = account.username;
  const obs = new Obs(); try { await obs.connect(obsConfig()); await obs.call('GetVersion'); } finally { obs.close(); }
  update(`Connected: Twitch ${stream.live ? 'LIVE' : 'offline'}, Instagram @${account.username}, OBS, and Cloudinary (${usage.plan}). No image was uploaded or published.`);
  return { stream, account };
}
async function cleanup(c, h) {
  for (const asset of h.assets.filter(a => a.cleanupReady && !a.deleted)) {
    try { await cloudinary(c, 'destroy', { public_id: asset.id, invalidate: 'true' }); asset.deleted = true; saveHistory(h); }
    catch { /* Keep queued for the next run. Never report a successful post as failed because cleanup failed. */ }
  }
}
async function post() {
  const c = config();
  if (!c.armed) throw new Error('Posting is disabled. Finish Setup and enable the Stream Deck button after reviewing the local preview.');
  required(c, ['twitchClientId', 'twitchClientSecret', 'cloudName', 'cloudKey', 'cloudSecret', 'instagramToken', 'instagramId']);
  update('Checking whether Twitch is live…');
  const stream = await twitch(c);
  if (!stream.live) throw new Error('Twitch says your channel is offline. Nothing was posted.');
  if (!stream.title?.trim()) throw new Error('Twitch returned an empty title. Nothing was posted.');
  status.caption = stream.title;
  const h = history();
  await cleanup(c, h);
  // Scope duplicate prevention to the Instagram account as well as this Twitch broadcast.
  const key = `${c.instagramId}:${stream.id}`;
  let record = h.streams[key];
  const decision = duplicateDecision(record);
  if (decision === 'done') { update('This Twitch broadcast has already been posted. No duplicate was created.'); return; }
  if (decision === 'uncertain') {
    const result = await graph(c, record.containerId, { fields: 'status_code' });
    if (result.status_code === 'PUBLISHED') { record.published = true; saveHistory(h); update('Instagram confirms the previous attempt was published. No duplicate was created.'); return; }
    throw new Error('A previous publish attempt has an uncertain result. Check Instagram before trying again; automatic reposting is blocked to avoid duplicates.');
  }
  if (!record?.containerId) {
    update('Capturing the OBS broadcast scene…');
    const imageData = await capture(true);
    const publicId = `twitch-instagram/${randomUUID()}`;
    h.assets.push({ id: publicId, cleanupReady: false, deleted: false }); saveHistory(h);
    update('Uploading the screenshot to your Cloudinary account…');
    const upload = await cloudinary(c, 'upload', { file: imageData, public_id: publicId, overwrite: 'false' });
    if (!upload.secure_url?.startsWith('https://')) throw new Error('Cloudinary did not return a secure image URL.');
    update('Sending the image and Twitch title to Instagram…');
    const container = await graph(c, `${c.instagramId}/media`, { image_url: upload.secure_url, caption: stream.title }, 'POST');
    if (!container.id) throw new Error('Instagram did not return a media container ID.');
    record = { containerId: container.id, assetId: publicId, caption: stream.title, created: new Date().toISOString(), publishAttempted: false, published: false };
    h.streams[key] = record; saveHistory(h);
  }
  const ready = await waitUntilReady(() => graph(c, record.containerId, { fields: 'status_code,status' }), { progress: update });
  if (ready !== 'PUBLISHED') {
    // Persist before making the side effect: a timeout or crash must never trigger a blind republish.
    record.publishAttempted = true; saveHistory(h);
    update('Image is ready. Publishing to Instagram…');
    try {
      const result = await graph(c, `${c.instagramId}/media_publish`, { creation_id: record.containerId }, 'POST');
      if (!result.id) throw new Error('Publish response was incomplete. Check Instagram before retrying.');
      record.mediaId = result.id;
    } catch (e) {
      // Meta explicitly rejected publication because processing is still in progress: safe to retry this same container later.
      if (e.subcode === 2207027) { record.publishAttempted = false; saveHistory(h); throw new Error('Instagram still needs time to process. Press the button again later; the same pending image will be checked.'); }
      throw e;
    }
  }
  record.published = true; record.publishedAt = new Date().toISOString();
  const asset = h.assets.find(a => a.id === record.assetId); if (asset) asset.cleanupReady = true;
  saveHistory(h);
  await cleanup(c, h);
  update('Posted to Instagram successfully. Caption: ' + record.caption);
}
function safeConfig(c) {
  return { ...Object.fromEntries(publicKeys.map(k => [k, c[k]])), saved: Object.fromEntries(secretKeys.map(k => [k, !!c[k]])) };
}
function validate(c) {
  c.twitchChannel = c.twitchChannel.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/\/$/, '').toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(c.twitchChannel)) throw new Error('Enter a valid Twitch channel name.');
  if (!/^v\d+\.0$/.test(c.apiVersion)) throw new Error('API version must look like v24.0.');
  if (c.instagramId && !/^\d+$/.test(c.instagramId)) throw new Error('Instagram account ID must contain numbers only.');
  if (c.cloudName && !/^[a-zA-Z0-9_-]+$/.test(c.cloudName)) throw new Error('Cloudinary cloud name is invalid.');
  if (!['instagram', 'facebook'].includes(c.instagramLogin)) throw new Error('Choose an Instagram login method.');
  c.armed = c.armed === true;
  return c;
}
const server = http.createServer(async (req, res) => {
  const send = (code, data, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'" }); res.end(type === 'application/json' ? JSON.stringify(data) : data); };
  if (req.headers.host !== `127.0.0.1:${PORT}`) return send(403, { error: 'Local access only.' });
  if (req.headers.origin && req.headers.origin !== ORIGIN) return send(403, { error: 'Local access only.' });
  const pathname = new URL(req.url, ORIGIN).pathname;
  try {
    if (req.method === 'GET' && ['/', '/ui.js', '/style.css'].includes(pathname)) {
      const file = pathname === '/' ? 'index.html' : pathname.slice(1);
      return send(200, fs.readFileSync(path.join(ROOT, file)), pathname === '/' ? 'text/html; charset=utf-8' : pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css');
    }
    if (req.headers['x-local-app'] !== 'twitch-instagram') return send(403, { error: 'Open the local setup page.' });
    if (req.method === 'GET' && pathname === '/status') return send(200, { ...status, config: safeConfig(config()) });
    if (req.method === 'GET' && pathname === '/preview.jpg') {
      const f = path.join(PRIVATE, 'preview.jpg');
      return fs.existsSync(f) ? send(200, fs.readFileSync(f), 'image/jpeg') : send(404, { error: 'Capture a preview first.' });
    }
    if (req.method !== 'POST') return send(404, { error: 'Not found.' });
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 50000) throw new Error('Request too large.'); }
    const input = JSON.parse(body || '{}');
    if (pathname === '/settings') {
      if (busy) throw new Error('Wait for the current operation to finish before changing settings.');
      const c = config();
      for (const k of publicKeys) if (Object.hasOwn(input, k)) c[k] = typeof input[k] === 'string' ? input[k].trim() : input[k];
      for (const k of secretKeys) if (input[k]?.trim()) c[k] = input[k].trim();
      // Replacing an account or connection always disarms posting until checked again.
      c.armed = false;
      saveConfig(validate(c)); update('Settings saved securely. Posting is disabled until connections are checked and you enable it.');
      return send(200, { ok: true });
    }
    if (pathname === '/check') { await exclusive(() => checkConnections(config())); return send(200, { ok: true }); }
    if (pathname === '/preview') {
      await exclusive(async () => { update('Capturing a local OBS preview…'); await capture(); const c = config(); if (c.twitchClientId && c.twitchClientSecret) status.caption = (await twitch(c)).title; update('Local preview captured. Nothing was uploaded or published.'); });
      return send(200, { ok: true });
    }
    if (pathname === '/arm') {
      await exclusive(async () => { const c = config(); await checkConnections(c); if (!fs.existsSync(path.join(PRIVATE, 'preview.jpg'))) throw new Error('Capture and review a local preview before enabling posting.'); c.armed = true; saveConfig(c); update('Stream Deck posting is enabled. One post per live Twitch broadcast.'); });
      return send(200, { ok: true });
    }
    if (pathname === '/disarm') { if (busy) throw new Error('Wait for the current operation to finish.'); const c = config(); c.armed = false; saveConfig(c); update('Posting disabled.'); return send(200, { ok: true }); }
    if (pathname === '/post') {
      if (busy) return send(409, { error: 'A request is already running.' });
      void exclusive(post).catch(() => {});
      return send(202, { ok: true });
    }
    return send(404, { error: 'Not found.' });
  } catch (e) { send(400, { error: e.message }); }
});
server.on('error', e => { if (e.code === 'EADDRINUSE') process.exit(0); console.error('Could not start local setup server.'); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => console.log('Twitch-to-Instagram ready at ' + ORIGIN));
