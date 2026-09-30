# Phase D — FUP enforcement

The specification this phase was built to. Kept in the repository so the
reasoning survives the code.

Base: `origin/main` at `09dd214`. Branch: `muse/phase-d`.

## Why this phase exists

`Package.fupLimit` has existed since the first schema. Nothing read it. A package
could promise 50 GB and a customer could use 400, and the system would say
"Within allowance" because there was no allowance to be within.

An ISP sells capped packages precisely because an uncapped one is unprofitable on
a shared uplink. A limit that is not enforced is not a commercial control, it is a
suggestion.

## D1 — Measuring the cycle

`customerCycleUsage(customerId)` sums the `OnlineSession` rows that started inside
the customer's current cycle.

The cycle comes from the **latest invoice's** `billingFrom`/`billingTo`, not from a
rolling window. That distinction is the whole thing: the number has to be
measured over the period the customer was charged for. A rolling 30-day window
would throttle someone for exceeding a period that is not on any bill, and they
would have no answer when they asked why.

Falling back to "now minus `package.validityDays`" only when there is no invoice
at all, because then there is nothing to align to.

`network-sync` stores `max(stored, reported)` for an open session, so a router
counter reset cannot make usage appear to fall — which is what makes a plain sum
of session rows the cycle total, with no double counting.

### Arithmetic

The sum is done in BigInt and converted to a `number` exactly once, at the end.
Adding converted per-session numbers would lose precision above 2^53 bytes
(about 9 PB), which a busy shared uplink can reach over a long cycle. One
conversion at the end keeps the figure exact for the comparison that matters.

### Known limitation — not hidden

If a session drops between two router syncs, the transfer made in that gap is
recorded nowhere: the row is closed holding whatever the last sync saw. Usage is
therefore **under-reported**, and under-reporting is the safe direction — a
customer is never throttled for traffic we failed to observe. Phase W's RADIUS
accounting closes the gap properly, because an Interim-Update carries the
authoritative counter rather than a snapshot that might have been missed.

## D2 — State

`Customer.fupThrottled` / `fupThrottledAt` and `Package.fupProfile`, plus the
`network.fupAction` setting with three values.

`fupAction` defaults to **off**. Throttling changes what a paying customer
actually gets, and that should be a decision an ISP makes after looking at its own
figures — not one inherited from installing software. The other two settings that
touch a paying customer (`autoReconnect`, `enforceOnSuspend`) default to on
because they restore or enforce something the customer has already paid for;
throttling restricts, which is the opposite.

## D3 — The job

Three rules shape `enforceFup()`:

- **Throttling is sticky within a cycle.** The flag is set once, and the profile
  is not re-applied on later runs. Without this, a customer over their limit
  produces an identical router write on every scheduled run, and a briefly
  unreachable router is written to a hundred times before anyone looks.
- **A package with no throttled profile cannot be throttled.** The customer is
  still notified, and the reason is recorded — which is more use than silently
  doing nothing, because the ISP learns the package needs fixing.
- **A hotspot router is never throttled.** There is no PPP secret to point at a
  different profile, so the only honest action is to tell the customer.

Suspension is not touched here. It is a billing decision, it belongs to the
expiry sweep, and it takes precedence — a suspended customer is left exactly as
they are.

A customer's own password is never involved. The profile is repointed on the
existing secret, so the credential they use does not change and their connection
survives.

The restore path clears the flag even when the package has no profile to restore
to, leaving them on the router's default. A customer stuck on the throttled
profile forever is worse than one on the package default.

## D4 — Surfacing it

A progress bar on the customer profile's Usage tab, with a badge. It renders
**nothing at all** when the package has no limit: a bar reading "0 / 0 GB" or the
word "Unlimited" is decoration that pushes the graphs down the page for a
customer whose package has no such concept.

The bar is capped at full width, because usage can run to several times the
limit before the next cycle and a bar that overflows its track looks broken
rather than like an overage. The colour changes at 80% and again at the limit, and
the number on the badge is what matters, not the colour.

The bell entry is conditional on a non-zero count, for the same reason the
progress bar is conditional on a limit: a permanent "Throttled: 0" trains people
to ignore the bell.

## D5 — This file
