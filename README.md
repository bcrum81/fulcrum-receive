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
2. **Reload any open Fulcrum tabs.** This also applies after every update of
   the extension.
3. With a Fulcrum tab open and signed in, open the extension's **Details →
   Extension options**. Click **+ Add receiving item** and type the received
   item's number. Then, for each component, enter its item number and the
   quantity per 1 received. Use **+ Add another component** for more. Item
   numbers are checked against Fulcrum through the open tab, and a ✓ shows
   the description. Click **Save settings**. These rules sync with your Chrome
   profile.

No API token is needed. Every call is made as whoever is signed in to Fulcrum
in that tab, so Fulcrum's own permissions apply. A user who can't add
inventory in Fulcrum can't add it here either. Fulcrum records the inventory
events under that user.

## How it works

- `hook.js` runs in the page's own JavaScript world. It watches Fulcrum's own
  requests without changing them:
  - It keeps the `Authorization` header Fulcrum sends to
    `go-internal-api.fulcrumpro.com`, so it can make calls as the same user.
  - `ReceivingEditPage/LoadReceivingEditPageQuery` gives the line items and
    their item ids.
  - `ReceivingEditPage/SaveReceivingEditPageQueryCommand` is used by both
    **Save** (`savingOnly: true`) and **Confirm Receipt** (`savingOnly:
    false`). The quantity received on each line is the sum of
    `lineItemUpdates[].lotUpdates[].quantityReceived`.
- `content.js` matches received lines to your rules (by item id, with item
  number as a fallback), shows the window, and receives each component the
  way the item page's **Add Inventory** does:
  - `GET /api/items/GetByNumberLatestRevision` gets the latest revision, its
    GL code and its default location.
  - `GET /api/items/{id}/default-inventory-unit-values` gets the unit values
    Add Inventory would pre-fill. These are blank while Fulcrum's
    "default manual inventory unit values" setting is off, which it is for
    Henry Holsters as of 2026-10-28.
  - `POST /api/v2/inventory/bulk-process-inventory-events` sends one
    `Receive`/`Receive` event per component.
- `background.js` passes item lookups from the options page to an open
  Fulcrum tab.

These are Fulcrum's internal endpoints (what its own UI calls), not the
public API, so a Fulcrum update could break them. If the window stops
appearing or receiving fails, check here first. Shapes were checked against
Fulcrum's UI code on 2026-10-28.

## Files

- `manifest.json`: Manifest V3. Runs on `*.fulcrumpro.com`; no other hosts.
- `hook.js`: watches Fulcrum's requests and makes API calls (page world).
- `content.js`: the Receive components window, the messages and the
  inventory calls.
- `background.js`: passes options-page lookups to a Fulcrum tab.
- `options.html` / `options.js`: the receiving items.
