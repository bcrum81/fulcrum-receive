// Options page: the API token (chrome.storage.local) and the receiving rules
// (chrome.storage.sync, so they follow the Chrome profile).
//
// Stored rule shape:
//   { trigger: { itemId, number, description },
//     components: [{ itemId, number, description, multiplier }] }
//
// Item numbers are looked up in Fulcrum as they're typed so the rule stores
// item ids; receiving lines are matched on the id.

const $ = (id) => document.getElementById(id);
let rules = [];

function setStatus(node, text, ok) {
  node.textContent = text;
  node.className = ok == null ? '' : ok ? 'ok' : 'bad';
}

function blankItem() {
  return { number: '', itemId: '', description: '' };
}

async function lookup(field, input, found) {
  const number = input.value.trim();
  field.number = number;
  field.itemId = '';
  field.description = '';
  field.error = '';
  if (!number) {
    found.textContent = '';
    return;
  }
  found.className = 'found';
  found.textContent = 'Looking up…';
  const res = await chrome.runtime.sendMessage({ type: 'findItem', number });
  if (input.value.trim() !== number) return; // typed again while waiting
  if (res && res.ok) {
    Object.assign(field, { number: res.item.number, itemId: res.item.itemId, description: res.item.description });
    input.value = res.item.number;
  } else {
    field.error = (res && res.error) || 'lookup failed';
  }
  showFound(field, found);
}

function showFound(field, found) {
  if (field.itemId) {
    found.className = 'found';
    found.textContent = '✓ ' + (field.description || field.number);
  } else if (field.error) {
    found.className = 'found err';
    found.textContent = field.error;
  } else {
    found.className = 'found';
    found.textContent = '';
  }
}

function itemField(field, placeholder) {
  const wrap = document.createElement('div');
  wrap.className = 'item';
  const input = document.createElement('input');
  input.placeholder = placeholder;
  input.value = field.number;
  const found = document.createElement('div');
  wrap.append(input, found);
  showFound(field, found);
  input.addEventListener('change', () => lookup(field, input, found));
  return wrap;
}

function render() {
  const box = $('rules');
  box.replaceChildren();
  if (!rules.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No receiving items yet.';
    box.append(p);
  }
  rules.forEach((rule, ri) => {
    const card = document.createElement('div');
    card.className = 'rule';

    const head = document.createElement('div');
    head.className = 'ruleHead';
    const field = document.createElement('div');
    field.className = 'field';
    const cap = document.createElement('label');
    cap.className = 'cap';
    cap.textContent = 'When this item is received';
    field.append(cap, itemField(rule.trigger, 'Item number, e.g. ITM-BUCKLE-V2-SINGLE-POINT-FEMALE'));
    const del = document.createElement('button');
    del.className = 'danger';
    del.textContent = 'Remove';
    del.title = 'Remove this receiving item and its components';
    del.addEventListener('click', () => { rules.splice(ri, 1); render(); });
    head.append(field, del);

    const comps = document.createElement('div');
    comps.className = 'comps';
    const ccap = document.createElement('div');
    ccap.className = 'comp';
    ccap.innerHTML = '<label class="cap">Also receive component</label><label class="cap" style="text-align:right">Qty per 1</label><span></span>';
    comps.append(ccap);
    rule.components.forEach((c, ci) => {
      const row = document.createElement('div');
      row.className = 'comp';
      const mult = document.createElement('input');
      mult.className = 'mult';
      mult.type = 'number';
      mult.min = '0';
      mult.step = 'any';
      mult.value = c.multiplier;
      mult.title = 'Quantity of this component per 1 of the received item';
      mult.addEventListener('input', () => { c.multiplier = mult.value; });
      const x = document.createElement('button');
      x.className = 'x';
      x.textContent = '×';
      x.title = 'Remove this component';
      x.addEventListener('click', () => { rule.components.splice(ci, 1); render(); });
      row.append(itemField(c, 'Component item number'), mult, x);
      comps.append(row);
    });
    const add = document.createElement('button');
    add.className = 'link';
    add.textContent = '+ Add another component';
    add.addEventListener('click', () => { rule.components.push({ ...blankItem(), multiplier: 1 }); render(); });
    comps.append(add);

    card.append(head, comps);
    box.append(card);
  });
}

function validate() {
  const problems = [];
  const triggers = new Set();
  rules.forEach((r, i) => {
    const name = r.trigger.number || `Receiving item ${i + 1}`;
    if (!r.trigger.itemId) problems.push(`${name}: item number not found in Fulcrum`);
    else if (triggers.has(r.trigger.itemId)) problems.push(`${name} is set up twice`);
    triggers.add(r.trigger.itemId);
    if (!r.components.length) problems.push(`${name}: add at least one component`);
    r.components.forEach((c, j) => {
      const cname = c.number || `component ${j + 1}`;
      if (!c.itemId) problems.push(`${name} → ${cname}: item number not found in Fulcrum`);
      if (!(Number(c.multiplier) > 0)) problems.push(`${name} → ${cname}: quantity must be more than 0`);
    });
  });
  return problems;
}

async function save() {
  const problems = validate();
  if (problems.length) {
    setStatus($('status'), 'Not saved. ' + problems.join('; '), false);
    return;
  }
  const clean = rules.map((r) => ({
    trigger: { itemId: r.trigger.itemId, number: r.trigger.number, description: r.trigger.description },
    components: r.components.map((c) => ({
      itemId: c.itemId, number: c.number, description: c.description, multiplier: Number(c.multiplier),
    })),
  }));
  try {
    await chrome.storage.sync.set({ rules: clean });
    setStatus($('status'), `Saved ${clean.length} receiving item${clean.length === 1 ? '' : 's'}.`, true);
  } catch (err) {
    setStatus($('status'), 'Not saved: ' + err.message, false);
  }
}

async function testToken() {
  setStatus($('tokenStatus'), 'Testing…');
  const res = await chrome.runtime.sendMessage({ type: 'validate' });
  if (res && res.ok) {
    const who = res.info && (res.info.name || res.info.domain);
    setStatus($('tokenStatus'), `✓ Token works${who ? ` (${who})` : ''}.`, true);
  } else {
    setStatus($('tokenStatus'), (res && res.error) || 'Test failed', false);
  }
}

$('saveToken').addEventListener('click', async () => {
  await chrome.storage.local.set({ apiToken: $('token').value.trim() });
  testToken();
});
$('testToken').addEventListener('click', testToken);
$('addRule').addEventListener('click', () => {
  rules.push({ trigger: blankItem(), components: [{ ...blankItem(), multiplier: 1 }] });
  render();
});
$('save').addEventListener('click', save);

(async () => {
  const [{ apiToken }, { rules: stored }] = await Promise.all([
    chrome.storage.local.get({ apiToken: '' }),
    chrome.storage.sync.get({ rules: [] }),
  ]);
  $('token').value = apiToken;
  if (apiToken) setStatus($('tokenStatus'), 'Token saved.', true);
  rules = stored;
  render();
})();
