// Runs in the page's own JavaScript world (MAIN) so it can see Fulcrum's API
// traffic. It never changes a request; it only reports two of them to
// content.js with window.postMessage:
//
//   LoadReceivingEditPageQuery         the receiving record's line items
//                                      (lineItem.id -> partId, part, uomShort)
//   SaveReceivingEditPageQueryCommand  Save (savingOnly: true) and Confirm
//                                      Receipt (savingOnly: false). Only a
//                                      successful Confirm is reported, with the
//                                      quantity received on each line.
//
// Shapes come from Fulcrum's UI bundle (receiving edit page store), checked
// 2026-10-28. Both calls go to https://go-internal-api.fulcrumpro.com.

(function () {
  const LOAD = '/api/ReceivingEditPage/LoadReceivingEditPageQuery';
  const SAVE = '/api/ReceivingEditPage/SaveReceivingEditPageQueryCommand';
  const SOURCE = 'fulcrum-receive-hook';

  function post(type, data) {
    window.postMessage({ source: SOURCE, type, data }, location.origin);
  }

  function parse(text) {
    if (typeof text !== 'string') return null;
    try { return JSON.parse(text); } catch (_) { return null; }
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
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__frUrl = String(url);
    return origOpen.apply(this, arguments);
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
})();
