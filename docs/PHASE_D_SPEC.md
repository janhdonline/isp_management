# Phase D (official) — Customer self-service portal + reseller management

Branch `muse/phase-d-portal`, from `origin/main` at `0470881`.

Note on naming: an earlier commit on this branch line (`219791b`, "Phase D: FUP
enforcement") was built against a different brief and is **not** this phase. It
stays where it is; nothing here replaces it.

## The one assumption in the plan that was wrong

The plan said to reuse how `Customer.password` is stored and authenticate portal
customers against it.

`Customer.password` is the **PPPoE secret**. It is stored in the clear because a
MikroTik needs it in the clear, and it is sent to the router in the clear on every
provisioning, reprofiling and deletion call. Authenticating anyone against it
would mean:

- the same credential exists in two places, and the copy in transit is readable;
- a technician who can see it can impersonate the customer in the portal;
- worse, the PPPoE password is routinely written on stickers and told to
  customers over the phone — so it is not a secret in any practical sense.

So the portal gets its own credential: `Customer.portalPasswordHash`, a bcrypt
hash, set by the customer or by staff. `Customer.password` is untouched and is
still never accepted as proof of identity anywhere.

A test asserts the PPPoE password is refused at the portal login, because that
is the property most likely to be quietly reintroduced later.

## Portal authentication

| Concern | Decision |
| --- | --- |
| Credential | `portalPasswordHash`, bcrypt cost 10, as staff |
| Cookie | `portal_session`, httpOnly, sameSite lax, path `/` |
| Secure flag | Keyed on `x-forwarded-proto`, not `NODE_ENV` — the same reasoning as staff, where a production build served over http silently drops the cookie and every page bounces to the login screen |
| Payload | `{ customerId, portalTokenVersion }` |
| Revocation | The customer's current `portalTokenVersion` must match the cookie. Setting or clearing the password bumps it, which ends every existing session |
| Disconnected line | Treated as no session — the account is closed |
| Unknown username | Same error as a wrong password, and the same bcrypt work done first, so the form cannot be used to enumerate customers |

## Isolation

Two directions, and the second is the one that is easy to get wrong:

- **Staff cookie → portal page.** `getPortalSession()` reads only
  `portal_session`, so a staff cookie satisfies nothing.
- **Portal cookie → staff page.** `getSession()` reads only `isp_session`. The
  proxy — which runs before any page code — also only checks `isp_session`, so a
  portal cookie is invisible to it.

The proxy steps aside for `/portal` and lets `requirePortalCustomer()` do the real
work in the page. It cannot do the job itself: it cannot read the customer id out
of the portal JWT, so a gate there could only check that *some* portal cookie
exists, which would let any signed-in customer reach any other customer's URL.

On every portal action the authority is the session, not a permission. A customer
has no staff permissions and must not acquire any by calling an action. The check
is ownership: the row's `customerId` must equal the session's, or it is refused.
Invoice and ticket pages select on `{ id }` and compare, rather than looking the
row up first and checking afterwards.

Internal staff notes are filtered in the query (`where: { isInternal: false }`),
not filtered after fetching, so a note cannot reach a customer's page even for one
render.

## Routes

| Route | Purpose |
| --- | --- |
| `/portal/login` | Sign in. Same error for unknown user and wrong password |
| `/portal` | Package, total due (via the same `syncCustomerBilling` the staff screen uses), expiry, cycle data usage |
| `/portal/invoices` | Their invoices |
| `/portal/invoices/[id]` | One invoice and **Pay Online** |
| `/portal/tickets` | Their requests |
| `/portal/tickets/new` | Raise one — `customerId` from the session, never the form |
| `/portal/tickets/[id]` | Status and conversation |
| `/portal/password` | Change the portal password |

The due figure is `syncCustomerBilling()`, the same recompute the staff customer
screen calls. A second formula would be a second answer to "what does this person
owe", and the two would eventually disagree.

## Resellers

Scope is tracking and reporting. No ledger, no login — the reasoning is in
`ISP.md`, and it is the important decision in this half of the phase.

``` text
collected  = SUM(Payment.amount WHERE collectedByResellerId = r AND in period)
commission = collected × commissionPct / 100
```

Derived on read. Two consequences worth naming: it cannot drift from the payments,
and a rate change applies to a period as reported. `commissionPct` is a `Decimal`,
because 7.5% is exact and a float is not.

The report shows staff-collected cash alongside the reseller half so the two add
up to the whole. A report that shows only the reseller half invites "and what
about the rest?" with no way to answer it.