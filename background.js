// Talks to the Fulcrum public API (https://api.fulcrumpro.com) with the token
// saved on the options page. The token stays in chrome.storage.local on this
// computer; it is never synced or sent anywhere else.
//
//   POST /api/items/list         {number, latestRevision}. `number` is not an
//                                exact filter ("HH-0001-01" also returns
//                                "HH-0001-01-ARCH"), so results are re-filtered.
//   POST /api/inventory/receive  {itemId, quantity, secondaryType, note}
//   GET  /api/auth/validate      token check for the options page

const API = 'https://api.fulcrumpro.com';

async function token() {
  const { apiToken } = await chrome.storage.local.get({ apiToken: '' });
  if (!apiToken) throw new Error('No Fulcrum API token. Add one on the extension options page.');
  return apiToken;
}

async function api(path, { method = 'GET', body, query } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      detail = j.title || j.message || (j.errors && JSON.stringify(j.errors)) || detail;
    } catch (_) { /* not JSON */ }
    if (res.status === 401) detail = 'the API token was rejected (401)';
    throw new Error(`Fulcrum API ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

async function findItem(number) {
  const wanted = number.trim();
  const items = await api('/api/items/list', {
    method: 'POST',
    query: { Skip: 0, Take: 100 },
    body: { number: wanted, latestRevision: true },
  });
  const exact = (items || []).filter(
    (i) => (i.number || '').trim().toLowerCase() === wanted.toLowerCase() && !i.isArchived
  );
  if (!exact.length) throw new Error(`No active item numbered "${wanted}".`);
  const i = exact[0];
  return { itemId: i.id, number: i.number, description: i.description || '', uom: i.unitOfMeasureName || '' };
}

async function receive({ itemId, quantity, note }) {
  await api('/api/inventory/receive', {
    method: 'POST',
    body: { itemId, quantity, secondaryType: 'receive', note: note ? note.slice(0, 2000) : null },
  });
  return { ok: true };
}

const handlers = {
  findItem: async (msg) => ({ ok: true, item: await findItem(msg.number) }),
  receive: async (msg) => receive(msg),
  validate: async () => ({ ok: true, info: await api('/api/auth/validate') }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  handler(msg)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});
