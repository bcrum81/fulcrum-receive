// After Confirm Receipt succeeds on a Fulcrum receiving record, opens a window
// listing the companion components configured for the items just received,
// with quantities filled in from the multipliers. Receive adds each one to
// inventory through the Fulcrum API (background.js).
//
// hook.js (page world) reports the receiving record's line items when the
// page loads and the quantities sent by each successful Confirm Receipt.

(function () {
  const SOURCE = 'fulcrum-receive-hook';
  const records = new Map(); // receiving record id -> { name, lines: Map(lineItemId -> line) }
  let dialog = null;

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== SOURCE) return;
    const { type, data } = e.data;
    if (type === 'load') {
      records.set(data.id, { name: data.name, lines: new Map(data.lineItems.map((l) => [l.id, l])) });
    } else if (type === 'confirmed') {
      onConfirmed(data).catch((err) => toast(`Component receiving failed: ${err.message || err}`, true));
    }
  });

  function round(n) {
    return Math.round(n * 10000) / 10000;
  }

  function fmt(n) {
    return String(round(n));
  }

  async function onConfirmed({ id, lines }) {
    // After the extension is reloaded or updated, scripts in already-open tabs
    // lose their connection to it and every chrome.* call throws.
    if (!chrome.runtime?.id) {
      toast('The Receive Components extension was updated. Reload this page to receive components.', true);
      return;
    }
    const record = records.get(id);
    if (!record) {
      console.warn('[Fulcrum Receive] confirm for a record that was never loaded', id);
      return;
    }
    const { rules } = await chrome.storage.sync.get({ rules: [] });
    if (!rules.length) return;

    // One row per component, summed across every received line (and every
    // rule) that calls for it.
    const rows = new Map();
    const sources = [];
    for (const { lineItemId, quantity } of lines) {
      const line = record.lines.get(lineItemId);
      if (!line) continue;
      const rule = rules.find((r) => r.trigger.itemId === line.partId)
        || rules.find((r) => r.trigger.number && r.trigger.number === line.part);
      if (!rule || !rule.components.length) continue;
      sources.push({ number: line.part || rule.trigger.number, quantity, uom: line.uomShort || '' });
      for (const c of rule.components) {
        const add = quantity * (Number(c.multiplier) || 0);
        const row = rows.get(c.itemId) || { ...c, quantity: 0, from: [] };
        row.quantity = round(row.quantity + add);
        row.from.push(`${fmt(quantity)} × ${line.part || rule.trigger.number} × ${fmt(c.multiplier)}`);
        rows.set(c.itemId, row);
      }
    }
    if (!rows.size) return;

    // Lines for the same item (e.g. three lines of one buckle) read as one.
    const merged = new Map();
    for (const s of sources) {
      const m = merged.get(s.number) || { ...s, quantity: 0 };
      m.quantity = round(m.quantity + s.quantity);
      merged.set(s.number, m);
    }
    openDialog(record.name || 'this receipt', [...merged.values()], [...rows.values()]);
  }

  function toast(message, isError) {
    let stack = document.getElementById('fulcrum-receive-toasts');
    if (!stack) {
      stack = document.createElement('div');
      stack.id = 'fulcrum-receive-toasts';
      Object.assign(stack.style, {
        position: 'fixed', right: '20px', bottom: '20px', zIndex: '2147483647',
        display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end',
      });
      document.documentElement.appendChild(stack);
    }
    const el = document.createElement('div');
    el.textContent = message;
    Object.assign(el.style, {
      padding: '12px 16px', borderRadius: '6px', maxWidth: '420px',
      font: '14px/1.4 system-ui, sans-serif', color: '#fff',
      background: isError ? '#b42318' : '#067647', boxShadow: '0 4px 12px rgba(0,0,0,.25)',
    });
    stack.appendChild(el);
    setTimeout(() => el.remove(), isError ? 9000 : 5000);
  }

  const CSS = `
    .backdrop { position: fixed; inset: 0; z-index: 2147483646; background: rgba(16,24,40,.55);
      display: flex; align-items: center; justify-content: center; font: 14px/1.4 system-ui, sans-serif; color: #1d2939; }
    .panel { background: #fff; border-radius: 10px; padding: 20px; width: 640px; max-width: calc(100vw - 32px);
      max-height: calc(100vh - 64px); display: flex; flex-direction: column; box-shadow: 0 12px 32px rgba(0,0,0,.3); }
    h2 { margin: 0 0 4px; font-size: 16px; }
    .sub { color: #475467; margin: 0 0 14px; }
    .list { overflow: auto; border: 1px solid #eaecf0; border-radius: 8px; }
    .row { display: grid; grid-template-columns: 1fr 110px 32px; gap: 10px; align-items: center;
      padding: 10px 12px; border-top: 1px solid #eaecf0; }
    .row:first-child { border-top: 0; }
    .head { font-size: 12px; font-weight: 600; color: #667085; background: #f9fafb; }
    .num { font-weight: 600; }
    .desc, .from { color: #667085; font-size: 12px; }
    .status { font-size: 12px; margin-top: 2px; }
    .status.ok { color: #067647; }
    .status.err { color: #b42318; }
    .row.done { background: #ecfdf3; }
    input { box-sizing: border-box; width: 100%; font: inherit; padding: 6px 8px; border: 1px solid #d0d5dd;
      border-radius: 6px; text-align: right; }
    input:disabled { background: #f2f4f7; color: #475467; }
    .remove { border: 0; background: none; font-size: 20px; line-height: 1; color: #98a2b3; cursor: pointer; padding: 4px; }
    .remove:hover { color: #b42318; }
    .remove:disabled { visibility: hidden; }
    .empty { padding: 16px; color: #667085; text-align: center; }
    .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
    button.btn { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid #d0d5dd; background: #fff; cursor: pointer; }
    button.primary { background: #1d2939; border-color: #1d2939; color: #fff; }
    button.btn:disabled { opacity: .5; cursor: default; }
  `;

  function el(tag, attrs, text) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (text != null) node.textContent = text;
    return node;
  }

  function openDialog(receiptName, sources, components) {
    if (dialog) dialog.close();
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>${CSS}</style>
      <div class="backdrop">
        <div class="panel" role="dialog" aria-label="Receive components">
          <h2>Receive components</h2>
          <p class="sub"></p>
          <div class="list">
            <div class="row head"><div>Component</div><div style="text-align:right">Quantity</div><div></div></div>
          </div>
          <div class="buttons">
            <button class="btn cancel">Cancel</button>
            <button class="btn primary receive">Receive</button>
          </div>
        </div>
      </div>`;
    const $ = (sel) => root.querySelector(sel);
    $('.sub').textContent = `${receiptName}: received ` +
      sources.map((s) => `${fmt(s.quantity)}${s.uom ? ' ' + s.uom : ''} × ${s.number}`).join(', ') +
      '. Check these quantities, then Receive to add them to inventory.';

    const list = $('.list');
    const receiveBtn = $('.receive');
    const cancelBtn = $('.cancel');
    const rows = components.map((c) => {
      const row = el('div', { class: 'row' });
      const info = el('div');
      info.append(el('div', { class: 'num' }, c.number));
      if (c.description) info.append(el('div', { class: 'desc' }, c.description));
      info.append(el('div', { class: 'from' }, c.from.join(' + ')));
      const status = el('div', { class: 'status' });
      info.append(status);
      const input = el('input', { type: 'number', min: '0', step: 'any', 'aria-label': `Quantity of ${c.number}` });
      input.value = fmt(c.quantity);
      const remove = el('button', { class: 'remove', title: 'Don’t receive this component', 'aria-label': `Remove ${c.number}` }, '×');
      row.append(info, input, remove);
      list.append(row);
      const entry = { c, row, input, remove, status, done: false, removed: false };
      remove.addEventListener('click', () => {
        entry.removed = true;
        row.remove();
        refresh();
      });
      input.addEventListener('input', refresh);
      return entry;
    });

    let running = false;
    const pending = () => rows.filter((r) => !r.removed && !r.done);
    function refresh() {
      const left = pending();
      if (!rows.some((r) => !r.removed) && !list.querySelector('.empty')) {
        list.append(el('div', { class: 'empty' }, 'No components left to receive.'));
      }
      if (!left.length) {
        receiveBtn.textContent = 'Close';
        receiveBtn.disabled = running;
        cancelBtn.hidden = true;
        return;
      }
      receiveBtn.textContent = rows.some((r) => r.status.classList.contains('err')) ? 'Retry' : 'Receive';
      receiveBtn.disabled = running || left.some((r) => !(Number(r.input.value) >= 0) || r.input.value === '');
    }

    async function receiveAll() {
      if (!pending().length) return close();
      running = true;
      refresh();
      for (const r of pending()) {
        const quantity = round(Number(r.input.value));
        r.input.disabled = true;
        r.remove.disabled = true;
        if (quantity === 0) {
          r.done = true;
          r.status.className = 'status';
          r.status.textContent = 'Skipped (quantity 0)';
          continue;
        }
        r.status.className = 'status';
        r.status.textContent = 'Receiving…';
        const note = `Received with ${receiptName} (${r.c.from.join(' + ')}) by the Fulcrum Receive Components extension`;
        let res;
        try {
          res = await chrome.runtime.sendMessage({ type: 'receive', itemId: r.c.itemId, quantity, note });
        } catch (err) {
          res = { ok: false, error: chrome.runtime?.id ? err.message : 'extension was updated; reload this page' };
        }
        if (res && res.ok) {
          r.done = true;
          r.row.classList.add('done');
          r.status.className = 'status ok';
          r.status.textContent = `✓ Received ${fmt(quantity)} into inventory`;
          toast(`✓ ${r.c.number}: received ${fmt(quantity)} into inventory`);
        } else {
          const error = (res && res.error) || 'unknown error';
          r.input.disabled = false;
          r.remove.disabled = false;
          r.status.className = 'status err';
          r.status.textContent = `Not received: ${error}`;
          toast(`${r.c.number} not received: ${error}`, true);
        }
      }
      running = false;
      refresh();
    }

    function close() {
      if (running) return;
      host.remove();
      dialog = null;
    }

    cancelBtn.addEventListener('click', close);
    receiveBtn.addEventListener('click', receiveAll);
    // Keep Fulcrum's keyboard shortcuts from firing while typing here.
    root.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') close();
      else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !receiveBtn.disabled) receiveAll();
    });
    for (const type of ['keyup', 'keypress']) root.addEventListener(type, (e) => e.stopPropagation());

    dialog = { close };
    document.documentElement.appendChild(host);
    refresh();
    const first = rows[0] && rows[0].input;
    if (first) { first.focus(); first.select(); }
  }
})();
