// Runs in the page's own JavaScript world (MAIN) so it can see Fulcrum's API
// traffic and call the API the same way Fulcrum's UI does, with the signed-in
// user's session. No API token is involved.
//
// What it watches (never changes):
//   - the Authorization header Fulcrum sets on its own requests to
//     go-internal-api, kept so this script can make calls as the same user
//   - LoadReceivingEditPageQuery: the receiving record's line items
//     (lineItem.id -> partId, part, uomShort)
//   - SaveReceivingEditPageQueryCommand: Save (savingOnly: true) and Confirm
//     Receipt (savingOnly: false). Only a successful Confirm is reported, with
//     the quantity received on each line.
//
// It talks to content.js with window.postMessage. content.js can ask it to
// make an API call ({type: 'call'}); the answer comes back as 'result'.
//
// Shapes come from Fulcrum's UI bundle, checked 2026-10-28 (receiving edit
// page store; the item page's Add Inventory).

(function () {
  const LOAD = '/api/ReceivingEditPage/LoadReceivingEditPageQuery';
  const SAVE = '/api/ReceivingEditPage/SaveReceivingEditPageQueryCommand';
  const API_HOST = /^https:\/\/go-internal-api\.fulcrumpro\.com$/;
  const SOURCE = 'fulcrum-receive-hook';
  let auth = null; // { header, base } from the latest request Fulcrum made
  const authWaiters = [];

  function post(type, data) {
    window.postMessage({ source: SOURCE, type, data }, location.origin);
  }

  function parse(text) {
    if (typeof text !== 'string') return null;
    try { return JSON.parse(text); } catch (_) { return null; }
  }

  function noteAuth(url, header) {
    if (!header || !/^Bearer\s+\S/i.test(header)) return;
    let origin;
    try { origin = new URL(url, location.href).origin; } catch (_) { return; }
    if (!API_HOST.test(origin)) return;
    auth = { header, base: origin };
    while (authWaiters.length) authWaiters.shift()();
  }

  function waitForAuth(ms) {
    if (auth) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(
        'Fulcrum session not found on this page yet. Reload the page and try again.')), ms);
      authWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  function onLoad(body) {
    if (!body || !Array.isArray(body.lineItems)) return;
    post('load', {
      id: body.id,
      name: body.name,
      lineItems: body.lineItems.map((l) => ({
        id: l.id,
        partId: l.partId,
        part: l.part,
        uomShort: l.uomShort,
      })),
    });
  }

  function onConfirm(request) {
    const lines = (request.lineItemUpdates || [])
      .map((u) => ({
        lineItemId: u.lineItemId,
        quantity: (u.lotUpdates || []).reduce((sum, lot) => sum + (Number(lot.quantityReceived) || 0), 0),
      }))
      .filter((l) => l.quantity > 0);
    if (lines.length) post('confirmed', { id: request.id, lines });
  }

  function handle(url, requestBody, status, responseText) {
    if (status < 200 || status >= 300) return;
    if (url.includes(LOAD)) {
      onLoad(parse(responseText));
    } else if (url.includes(SAVE)) {
      const request = parse(requestBody);
      const response = parse(responseText);
      // A 200 can still carry errors; only a clean receipt counts.
      if (response && Array.isArray(response.errors) && response.errors.length) return;
      if (request && request.savingOnly === false) onConfirm(request);
    }
  }

  const watched = (url) => url.includes(LOAD) || url.includes(SAVE);

  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__frUrl = String(url);
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (/^authorization$/i.test(name) && this.__frUrl) noteAuth(this.__frUrl, value);
    return origSetHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this.__frUrl && watched(this.__frUrl)) {
      this.addEventListener('load', () => {
        try {
          const text = this.responseType === '' || this.responseType === 'text'
            ? this.responseText
            : JSON.stringify(this.response);
          handle(this.__frUrl, body, this.status, text);
        } catch (err) {
          console.warn('[Fulcrum Receive] could not read response', err);
        }
      });
    }
    return origSend.apply(this, arguments);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    try {
      const headers = new Headers((init && init.headers) || (input instanceof Request ? input.headers : undefined));
      noteAuth(url, headers.get('Authorization'));
    } catch (_) { /* unusual headers object; ignore */ }
    const promise = origFetch.apply(this, arguments);
    if (!watched(url)) return promise;
    const bodyPromise = init && typeof init.body === 'string'
      ? Promise.resolve(init.body)
      : input instanceof Request ? input.clone().text().catch(() => null) : Promise.resolve(null);
    promise.then((res) => {
      Promise.all([bodyPromise, res.clone().text()])
        .then(([body, text]) => handle(url, body, res.status, text))
        .catch((err) => console.warn('[Fulcrum Receive] could not read response', err));
    }, () => {});
    return promise;
  };

  // API calls on behalf of content.js, as the signed-in user.
  async function call({ method, path, body }) {
    await waitForAuth(10000);
    const res = await origFetch(auth.base + path, {
      method,
      headers: { Authorization: auth.header, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
    });
    const text = await res.text();
    return { status: res.status, body: parse(text), text: text.slice(0, 500) };
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'fulcrum-receive-content' || e.data.type !== 'call') return;
    const { id, request } = e.data;
    call(request)
      .then((result) => post('result', { id, ok: true, ...result }))
      .catch((err) => post('result', { id, ok: false, error: err.message || String(err) }));
  });
})();
