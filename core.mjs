import { createHash, randomUUID } from 'node:crypto';

export class ServiceError extends Error {
  constructor(service, status, detail = {}) {
    super(`${service} request failed (${status}${detail.code ? `, code ${detail.code}` : ''}${detail.error_subcode ? `/${detail.error_subcode}` : ''}). Check the connection in Setup.`);
    this.service = service; this.status = status; this.code = detail.code; this.subcode = detail.error_subcode;
  }
}
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const sha = text => createHash('sha256').update(text).digest('base64');
export function obsAuthentication(password, salt, challenge) { return sha(sha(password + salt) + challenge); }
export function photoSize(width, height) {
  if (!(width > 0 && height > 0)) throw new Error('OBS returned invalid canvas dimensions.');
  const ratio = width / height;
  if (ratio < 0.8 || ratio > 1.91) throw new Error('Your OBS canvas is outside Instagram photo proportions (4:5 to 1.91:1). Use a suitable canvas or add an image-padding step before posting.');
  return { imageWidth: 1080, imageHeight: Math.round(1080 / ratio) };
}
export function required(config, names) {
  const missing = names.filter(name => !String(config[name] || '').trim());
  if (missing.length) throw new Error(`Finish Setup first: ${missing.join(', ')}.`);
}
export function formatCaption(config, title) {
  const caption = [config.captionPrefix, title, config.captionSuffix]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
  if (caption.length > 2200) throw new Error('The Instagram caption exceeds 2,200 characters. Shorten the prefix or suffix.');
  return caption;
}
export async function request(service, url, options = {}) {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(45000) }); }
  catch { throw new ServiceError(service, 'connection timeout or network error'); }
  let data; try { data = await response.json(); } catch { throw new ServiceError(service, response.status); }
  if (!response.ok || data.error) throw new ServiceError(service, response.status, typeof data.error === 'object' ? data.error : {});
  return data;
}
export class Obs {
  async connect(config) {
    this.pending = new Map();
    this.socket = new WebSocket(`ws://127.0.0.1:${config.server_port || 4455}`);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); reject(new Error('OBS did not respond. Open OBS and check Tools → WebSocket Server Settings.')); }, 12000);
      const fail = () => { clearTimeout(timer); reject(new Error('Cannot connect to OBS. Open OBS and enable its WebSocket server.')); };
      this.socket.addEventListener('error', fail, { once: true });
      this.socket.addEventListener('close', () => {
        fail();
        for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('OBS connection closed.')); }
        this.pending.clear();
      });
      this.socket.addEventListener('message', event => {
        let message; try { message = JSON.parse(event.data); } catch { return; }
        if (message.op === 0) {
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          if (message.d.authentication) d.authentication = obsAuthentication(config.server_password || '', message.d.authentication.salt, message.d.authentication.challenge);
          this.socket.send(JSON.stringify({ op: 1, d }));
        } else if (message.op === 2) { clearTimeout(timer); resolve(); }
        else if (message.op === 7) {
          const p = this.pending.get(message.d.requestId); if (!p) return;
          this.pending.delete(message.d.requestId); clearTimeout(p.timer);
          if (message.d.requestStatus.result) p.resolve(message.d.responseData || {});
          else p.reject(new Error(`OBS could not complete ${p.type} (code ${message.d.requestStatus.code}).`));
        }
      });
    });
  }
  call(type, data = {}) {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`OBS ${type} timed out.`)); }, 12000);
      this.pending.set(id, { resolve, reject, timer, type });
      this.socket.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data } }));
    });
  }
  close() { this.socket?.close(); }
}
export async function twitch(config) {
  required(config, ['twitchChannel', 'twitchClientId', 'twitchClientSecret']);
  const token = await request('Twitch login', 'https://id.twitch.tv/oauth2/token', { method: 'POST', body: new URLSearchParams({ client_id: config.twitchClientId, client_secret: config.twitchClientSecret, grant_type: 'client_credentials' }) });
  const headers = { 'Client-Id': config.twitchClientId, Authorization: `Bearer ${token.access_token}` };
  const streams = await request('Twitch', `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(config.twitchChannel)}`, { headers });
  if (streams.data?.length) return { ...streams.data[0], live: true };
  const users = await request('Twitch', `https://api.twitch.tv/helix/users?login=${encodeURIComponent(config.twitchChannel)}`, { headers });
  if (!users.data?.length) throw new Error('Twitch channel was not found.');
  const channels = await request('Twitch', `https://api.twitch.tv/helix/channels?broadcaster_id=${users.data[0].id}`, { headers });
  return { live: false, title: channels.data?.[0]?.title || '', user_name: users.data[0].display_name };
}
export function graph(config, path, params = {}, method = 'GET') {
  required(config, ['instagramToken', 'instagramId']);
  const host = config.instagramLogin === 'facebook' ? 'graph.facebook.com' : 'graph.instagram.com';
  const url = new URL(`https://${host}/${config.apiVersion || 'v24.0'}/${path}`);
  const options = { method, headers: { Authorization: `Bearer ${config.instagramToken}` } };
  if (method === 'GET') url.search = new URLSearchParams(params).toString();
  else options.body = new URLSearchParams(params);
  return request('Instagram', url, options);
}
export async function cloudinary(config, action, values) {
  required(config, ['cloudName', 'cloudKey', 'cloudSecret']);
  const params = { ...values, timestamp: String(Math.floor(Date.now() / 1000)) };
  const signatureText = Object.keys(params).filter(k => k !== 'file').sort().map(k => `${k}=${params[k]}`).join('&');
  const signature = createHash('sha1').update(signatureText + config.cloudSecret).digest('hex');
  return request('Cloudinary', `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/${action}`, { method: 'POST', body: new URLSearchParams({ ...params, api_key: config.cloudKey, signature }) });
}
export async function cloudUsage(config) {
  required(config, ['cloudName', 'cloudKey', 'cloudSecret']);
  return request('Cloudinary', `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/usage`, { headers: { Authorization: 'Basic ' + Buffer.from(`${config.cloudKey}:${config.cloudSecret}`).toString('base64') } });
}
export async function waitUntilReady(read, { wait = sleep, attempts = 6, interval = 60000, progress = () => {} } = {}) {
  for (let i = 0; i < attempts; i++) {
    const status = await read();
    if (status.status_code === 'FINISHED' || status.status_code === 'PUBLISHED') return status.status_code;
    if (['ERROR', 'EXPIRED'].includes(status.status_code)) throw new Error(`Instagram media processing ended with ${status.status_code}. Nothing new was published.`);
    if (i < attempts - 1) { progress('Instagram is processing the image. Waiting before checking again…'); await wait(interval); }
  }
  throw new Error('Instagram is still processing. The pending image is saved; press the button later to check it again.');
}
export function duplicateDecision(record) {
  if (!record) return 'new';
  if (record.published) return 'done';
  if (record.publishAttempted) return 'uncertain';
  if (record.containerId) return 'resume';
  return 'new';
}
