const $ = id => document.getElementById(id);
const headers = { 'X-Local-App': 'twitch-instagram', 'Content-Type': 'application/json' };
let initialized = false;
async function call(route, body = {}) {
  const r = await fetch(route, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) throw new Error(data.error); return data;
}
async function image() {
  const r = await fetch('/preview.jpg', { headers }); if (!r.ok) return;
  if ($('image').src.startsWith('blob:')) URL.revokeObjectURL($('image').src);
  $('image').src = URL.createObjectURL(await r.blob()); $('previewBox').hidden = false;
}
async function refresh() {
  try {
    const r = await fetch('/status', { headers }); const state = await r.json();
    $('status').textContent = state.message;
    $('caption').textContent = state.caption || 'Connect Twitch to load your stream title.';
    $('mode').textContent = state.config.armed ? 'Posting enabled · one post per broadcast' : 'Posting disabled';
    $('mode').classList.toggle('armed', state.config.armed);
    document.querySelectorAll('button').forEach(b => b.disabled = state.busy);
    if (!initialized) {
      for (const [key, value] of Object.entries(state.config)) { const el = $('settings').elements.namedItem(key); if (el && typeof value === 'string') el.value = value; }
      initialized = true;
    }
    for (const [key, saved] of Object.entries(state.config.saved)) $('settings').elements.namedItem(key).placeholder = saved ? 'Saved securely — leave blank to keep' : 'Not connected yet';
  } catch { $('status').textContent = 'Local helper is not responding. Open “Open Setup.vbs” again.'; }
}
async function action(route) {
  try { await call(route); await refresh(); if (route === '/preview') await image(); }
  catch (e) { $('status').textContent = e.message; }
}
$('settings').addEventListener('submit', async e => {
  e.preventDefault();
  try {
    await call('/settings', Object.fromEntries(new FormData(e.target)));
    e.target.querySelectorAll('input[type=password]').forEach(el => el.value = ''); await refresh();
  } catch (error) { $('status').textContent = error.message; }
});
for (const name of ['check', 'preview', 'arm', 'disarm']) $(name).addEventListener('click', () => action('/' + name));
refresh(); setInterval(refresh, 3000);
