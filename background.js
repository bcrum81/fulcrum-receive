// The options page has no Fulcrum session of its own, so item lookups are
// passed to an open Fulcrum tab, where content.js makes the call with the
// signed-in user's session.

async function findItem(number) {
  const tabs = await chrome.tabs.query({ url: 'https://*.fulcrumpro.com/*' });
  if (!tabs.length) throw new Error('Open Fulcrum in a tab (signed in) to look up item numbers.');
  let lastError = null;
  // Prefer the tab used most recently; fall through tabs that can't answer
  // (opened before the extension was installed, still loading, signed out).
  tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  for (const tab of tabs) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: 'findItem', number });
      if (res && res.ok) return res;
      lastError = (res && res.error) || 'lookup failed';
      if (/^No active item/.test(lastError)) return res;
    } catch (_) {
      lastError = 'Reload your Fulcrum tab, then try again.';
    }
  }
  return { ok: false, error: lastError };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'findItem') return false;
  findItem(msg.number)
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});
