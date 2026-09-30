# Demo guide

What to show, in what order, and what to say. Written to be followed with a
browser open next to it.

The demo dataset is deliberately not tidy. Customers are suspended and
disconnected, tickets sit at mixed stages, stock runs low, and one invoice is
left unpaid on purpose. An ISP management system with nothing wrong in it looks
like a form; the state of the data is the part that demonstrates anything.

---

## Credentials

### Staff (the operator's console)

Sign in at `/login` with the **email address**.

| Role | Email | Password | Sees |
| --- | --- | --- | --- |
| System Administrator | `admin@isp.com` | `admin123` | everything |
| Manager | `manager@isp.com` | `manager123` | everything except user management |
| Technician | `tech@isp.com` | `tech123` | network, tickets — no money, no billing |

The three-way split is worth showing on purpose: sign in as the technician and
point out that the billing and accounts menus are simply not there. Permissions
are enforced by role, not hidden cosmetically.

### Customers (the portal)

Sign in at `/portal/login` with the **PPPoE username** — not an email.

| Username | Portal password | State |
| --- | --- | --- |
| `nabila1` | `portal1` | outstanding balance, 3 support tickets |
| `nusrat2` | `portal2` | a large outstanding balance |

Use `nabila1` for the walkthrough. Their data has the most to look at.

> A customer's portal password is **not** their PPPoE password. The router
> password is stored in plain text and sent to the router in clear; the portal
> password is a separate bcrypt hash. They are unrelated, and changing one does
> not touch the other.

---

## The walkthrough

Twelve steps. Resist going deeper — the depth is for questions, not for the
first pass.

**1. Dashboard.** Revenue collected, active customers, due amount, open
tickets, expenses. The numbers are non-zero and varied because the seed models a
month of trading rather than an empty install.

**2. Customers.** Point at the status column: Active, Suspended and Disconnected
all appear. Click one in a state other than Active and mention that the system
applies the consequence to the router rather than only recording a label.

**3. A customer profile.** Billing history, payments, support history and
current FUP usage on one page. This is the screen an operator actually lives in.

**4. Inventory.** Stock on hand, and two items showing as low against their
reorder level. Items already issued to customers are not counted as free stock —
the count is the physical shelf.

**5. Network → Enforcement.** The queue of actions sent to routers, with
outcomes. **This is the most interesting screen in the application.** A suspension
is not a database row here; it is a queued action that a cron job delivers to the
router and records the result of, with retries on failure. Say that the
disconnect actually happens on the MikroTik — most competing products do not.

**6. Support.** A mix of open, in-progress and resolved tickets.

**7. Sign out. Open `/portal/login` in a private window.** Being explicit that
this is a *different login* is the point — customers and staff are separate
identities with separate sessions, and neither can reach the other.

**8. Portal overview as `nabila1`.** The outstanding balance is visible, and it
matches the amount the staff console shows for the same customer. Same data,
two doors.

**9. Portal → Invoices → Pay Online.** With no payment gateway configured, the
buttons are *absent* rather than present-and-broken. If asked, the gateway is
configured in Settings (SSLCommerz), and leaving it blank is the intended demo
state.

**10. Portal → Tickets → raise one.** Submit something plausible ("ONU light
blinking red"). It appears immediately.

**11. Sign in as staff → Support.** The new ticket is in the queue, under
`nabila1`, with the customer identified. Close the loop explicitly — the
customer raised it, the operator sees it.

**12. Resellers → Commission Report.** One reseller has several attributed
payments, so the report has a non-zero commission beside the staff-collected
figure. Commission is derived from the payments on every read and never stored,
so it cannot drift out of step with the money actually collected.

---

## Things worth saying

**Money is derived, not typed.** Invoice totals come from package price,
installation fee and validity. Reseller commission is computed from attributed
payments. A balance is recomputed from invoices. There is no field an operator
can edit into disagreeing with the records.

**The demo gateway is off by design.** Online payment needs a merchant account.
Rather than a button that fails, the feature reports itself unconfigured.

**State is real.** Suspending a customer enqueues a router action; if the router
is unreachable the action retries on a backoff ladder and stays visible on the
enforcement page rather than failing silently.

---

## If asked what is not finished

Worth being straight about these before someone else finds them:

- **The payment gateway is unconfigured.** The SSLCommerz integration is
  implemented and webhook-validated, but no merchant account is attached, so
  that path has not been exercised against the live gateway.
- **Routers are simulated in the demo.** The MikroTik adapter talks to a mock
  unless a real router is configured. The protocol handling is real; the device
  is not.
- **BTRC regulatory reporting is not built.** Monthly subscriber and revenue
  returns are not implemented.
- **No RADIUS integration.** Usage is read from the router's own session table.
  There *is* a RADIUS section under **Settings → Network** where you can type a
  server address and a shared secret — but nothing reads those values yet, so
  entering them changes nothing. Be straight about that if you point it out; it
  is scaffolding for a later phase, not a working feature.
- **FUP throttling is best-effort by design.** Throttling applies at the next
  router poll, not instantly, and enforcement pauses during a grace window so a
  customer is not disconnected for an overnight outage that has already cleared.
- **Customer deletion does not preserve the serial ↔ customer link.** Stock and
  the ledger are returned correctly, but the equipment assignment rows are
  removed with the customer. Known limitation, not yet fixed.