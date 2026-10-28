# Fulcrum Receive Components (Chrome extension)

When **Confirm Receipt** on a Fulcrum receiving record
(`https://<company>.fulcrumpro.com/ui/receive/edit/PO/<id>`) receives an item
you've set up, a window opens listing that item's companion components. Their
quantities are pre-filled as *quantity received × multiplier*. You can change a
quantity or remove a line, then click **Receive**. Each component is added to
inventory, and you get a success (or error) message for each one.

Example: receive 10 × `ITM-BUCKLE-V2-SINGLE-POINT-FEMALE`, set up with
`SCREW-A` × 2 and `SPRING-B` × 3 → the window offers 20 × `SCREW-A` and
30 × `SPRING-B`.

- The window only opens after Fulcrum reports that the receipt succeeded. A
  failed confirm or a plain **Save** doesn't open it.
- If several lines (or several set-up items) call for the same component, they
  are added together into one row. The row shows where the number came from.
- Rows that fail stay editable, and the button changes to **Retry**. Rows
  that succeeded are locked, so they can't be received twice.
- Each inventory receipt carries a note, e.g. *Received with PO3401 (10 ×
  ITM-BUCKLE-… × 2) by the Fulcrum Receive Components extension*.

## Install

1. In Chrome, open `chrome://extensions`, turn on **Developer mode**, click
   **Load unpacked**, and pick this folder (the one with `manifest.json`).
2. Open the extension's **Details → Extension options**.
3. Paste a Fulcrum **API token** (Fulcrum: System Data → Advanced → Public API
   Setup), then click **Save token**. It should say *Token works*. The token is
   kept only in this browser on this computer (`chrome.storage.local`).
4. Click **+ Add receiving item**. Type the received item's number, then
   for each component enter its item number and the quantity per 1 received.
   Use **+ Add another component** for more. Item numbers are checked against
   Fulcrum as you type, and a ✓ shows the description. Click **Save
   settings**. These rules sync with your Chrome profile.
5. **Reload any open Fulcrum tabs.** This also applies after every update of
   the extension.

## How it works

- `hook.js` runs in the page's own JavaScript world. It watches two of
  Fulcrum's internal API calls without changing them:
  `ReceivingEditPage/LoadReceivingEditPageQuery` (line item → item id) and
  `ReceivingEditPage/SaveReceivingEditPageQueryCommand`. That second call is
  used by both **Save** (`savingOnly: true`) and **Confirm Receipt**
  (`savingOnly: false`). The quantity received on each line is the sum of
  `lineItemUpdates[].lotUpdates[].quantityReceived`. These are Fulcrum
  internals, not a public API, so a Fulcrum UI update could break detection.
  If the window stops appearing, check here first.
- `content.js` matches received lines to your rules by item id (and by item
  number as a fallback) and shows the window.
- `background.js` calls the public API at `https://api.fulcrumpro.com`:
  `POST /api/items/list` to look up item numbers, and
  `POST /api/inventory/receive` (`secondaryType: "receive"`) to add the
  component inventory.

Components are received with **no location and no unit cost**. They go to
the default location at $0 value, the same as the shop's check-in app. If
these components need a cost, that's a follow-up.

## Files

- `manifest.json`: Manifest V3. Runs on `*.fulcrumpro.com`. Its only other
  host is `api.fulcrumpro.com`.
- `hook.js`: watches the receiving API calls (page world).
- `content.js`: the Receive components window and the messages.
- `background.js`: Fulcrum public API calls.
- `options.html` / `options.js`: the API token and the receiving items.
