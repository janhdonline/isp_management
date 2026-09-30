# Phase C — Inventory and MikroTik auto-provisioning

The specification this phase was built to. It is kept in the repository so the
reasoning survives the code, and so the next person does not have to reverse a
decision out of a diff.

Base: `origin/main` at `e098401`. Branch: `muse/phase-c`.

## Why this phase exists

Two gaps, both of which cost an ISP money rather than convenience.

**There was no record of the equipment.** A hundred ONUs in the store is a stock
figure nobody had; the ONU with serial `X` in Rahim's flat is a thing that can be
traced, swapped, or produced for a BTRC audit. Neither existed. So a swap-out
meant guessing, and a missing device was simply gone.

**Nothing was ever provisioned on the router.** Phase A made suspension reach the
network, which meant a suspended customer could be cut off — but a *new*
customer still had to be typed into the MikroTik by hand, and a package change
changed the figure on the bill and nothing else. "10 Mbps" was a label on an
invoice.

## C1 — Models

`InventoryItem`, `StockMovement`, `CustomerEquipment`.

The rule the whole module turns on: **`InventoryItem.quantity` is never typed in
by anyone.** It is the sum of `StockMovement` rows, and the movement and the
balance are written in the same transaction. A stock figure that can be edited
directly is a stock figure that will be wrong, and an ISP that thinks it has
twenty spare ONUs and has four turns away customers.

`CustomerEquipment` is separate from the ledger on purpose: a stock count and a
device in someone's house are different facts, and a return needs both.

## C2 — Inventory UI

`Inventory` added to `PERMISSION_RESOURCES`, so `inventory.view/create/edit/
delete` generate automatically, plus a sidebar section and two pages.

Two decisions worth recording:

- **A reorder level of zero switches the warning off** rather than meaning
  "reorder when empty". Otherwise every item created with the default level
  lights up the low-stock list the moment it is empty, and an alert that is
  always on is one nobody reads.
- **"Low stock" is `quantity <= reorderLevel`**, a comparison between two columns
  of one row. Prisma cannot express that in a `where`, and hard-coding
  `lte: 0` returns only the genuinely empty items — hiding exactly the ones that
  need ordering. It is filtered after the derived flag, deliberately.

`DataTableShell` gained an optional `rowClassName` so a short shelf is a tinted
row rather than a badge in one column. A column of badges reads as decoration; a
column of tinted rows reads as a problem.

## C3 — Package to profile mapping

`Package.mikrotikProfile`, optional. Blank means the secret is provisioned with no
profile, which leaves the router's own default in place — the same as not
touching it, stated explicitly rather than guessed at.

## C4 — Adapter methods

`provisionSecret`, `setSecretProfile`, `removeSecret` on `NetworkAdapter`.

`removeSecret` deletes rather than disables, because a disabled secret left
behind is not neutral: the next subscriber at that address inherits somebody
else's credentials.

`DatabaseNetworkAdapter` returns `true` for all three, and its comment is
emphatic that this means "there is no configured router", not "the work
happened". `live` is already `false`, so anything built on it is labelled.

## C5 — Enforcement dispatch

`runEnforcement` dispatches on the action. The profile is carried **on the
queue row** rather than re-derived at retry time, so a profile change that fails
and is retried after a *further* package change still applies what it was raised
for instead of the newer speed.

The retry job's "is this still wanted?" check applies to `suspend` and
`reconnect` only. That asymmetry is the subtle part:

- A **suspend** is a statement about whether the customer may be online. A queued
  suspend for someone who has since paid is obsolete and must be dropped —
  executing it cuts off a customer who owes nothing.
- A **provision** or **profile change** is a statement about what their access
  should look like, which stays true regardless of status. Applying the same
  check would silently drop a queued provision for a customer who happened to be
  suspended between the record being created and the router coming back — and
  that subscriber is then never configured at all.

Failures stay `Pending`, never terminal. Backoff and the ten-attempt cap are
unchanged from Phase A.

## C6 — Customer actions

- **Create** — after the commit, and only for a PPPoE router. Hotspot has no
  secret to create, so it is skipped and logged rather than attempted. A failure
  never blocks the customer: the record exists and the action is queued. The
  message says "Router provisioning is queued" rather than claiming success.
- **Package change** — only when the profile actually differs. Repointing a
  secret to the profile it already has is a wasted write and a wasted lock.
- **Delete** — best effort, and the username is read *before* the row goes,
  because afterwards there is nothing left to retry against. A router that cannot
  be reached does not block the deletion; it produces a message saying the secret
  should be removed by hand.

## C7 — This file

Kept in `docs/` so the decisions above are not lost with the conversation that
produced them.
