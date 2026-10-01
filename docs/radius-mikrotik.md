# MikroTik + RADIUS

How to point a MikroTik router at this application's RADIUS server, and what to
check when a subscriber will not log in.

Read this in order. The three steps have to happen in this order: a router that is
switched to RADIUS before the server is running has no way to authenticate anyone.

---

## Before you start

| Setting | Where | What it is |
|---------|-------|-----------|
| `network.radiusSecret` | Settings → Network | The shared secret. **Must match on both sides.** |
| `network.radiusServer` | Settings → Network | The address routers point at. This host, not the router. |
| `network.radiusPort` | Settings → Network | 1812, unless you changed it. |
| `network.nasCoaPort` | Settings → Network | Where the *router* listens for Disconnect-Requests. Default 3799. |

Two ports that are easy to confuse:

- `network.radiusCoaPort` (3799) is where **this server listens** for CoA.
- `network.nasCoaPort` (3799) is where **the router listens**, which is where a
  Disconnect-Request is *sent*.

A suspension sends a Disconnect-Request to `network.nasCoaPort` on the router. If
that is pointed at this server instead, every suspension reports a live customer
as still connected.

### The process must be running

```
npm run radius
```

Not part of `npm run dev`. It is a separate process on purpose — see the README.
If it is not running, no router switched to RADIUS can authenticate anybody, and
the dashboard says **RADIUS is DOWN**.

---

## 1. The router

In Winbox: **PPP → AAA** (RouterOS 7) or **PPP → AAA** (RouterOS 6).

| Field | Value |
|-------|-------|
| Address | This server's address, e.g. `10.10.0.5` |
| Secret | Exactly the same string as `network.radiusSecret` |
| Port | 1812 |
| Timeout | 300ms |
| Interim-update | **5m** |

Then, per PPP profile (**PPP → Profiles**):

- **Use RADIUS** — checked
- **Use MTU** — leave as the router default
- Leave `local` and `remote` addresses alone; RADIUS assigns them.

`Use RADIUS` on the profile is the switch that matters. Setting it on the AAA tab
alone leaves the profile authenticating locally.

### Why interim-update is 5 minutes

An Interim-Update is the live heartbeat of a session, and this is what makes
accounting useful rather than approximate:

- It is how FUP (Fair Usage Policy) notices a customer over their allowance
  before the month ends, rather than at the end of it.
- It is how the online list stays accurate for a customer whose router rebooted
  mid-session and never sent a Stop.
- It is how a session's live duration is known.

Every 5 minutes is the usual compromise. Every 1 minute is more precise and more
accounting traffic; every 15 minutes and a customer's usage is wrong by up to a
quarter of an hour.

### Why accept CoA

**PPP → AAA → CoA** or **IP → Services → Access List → RADIUS** (RouterOS 7):

- **Accept CoA from** — this server's address, or any
- **Port** — 3799

Without this the router silently ignores Disconnect-Requests, and a suspended
customer stays online until their PPPoE lease expires. The suspension is recorded
as done in this application, which is why this box matters.

---

## 2. The router, here

Network → Routers → *your router* → **Authenticate subscribers with RADIUS**.

Off by default, and it should stay off until steps 1 and 3 are done. Turning it on
tells this application to answer every PPPoE login for the subscribers behind that
router.

Note the other switch, **auto-provision**, is about secrets *on the router* and is
independent. With RADIUS on, this application never creates or disables a PPP
secret for that router's subscribers — there is nothing on the router to disable.

---

## 3. Prove the secret

Network → **RADIUS Live** → **Send a test auth**.

Enter a username and password that should work.

| What you see | What it means |
|--------------|---------------|
| Access-Accept, with a rate limit | The secret matches and the subscriber is eligible. You are done. |
| Access-Reject, but a reply arrived | **The secret matches.** The subscriber is the problem — check their status and expiry. |
| No reply | The process is not running, the port is wrong, or the secret differs. |
| No reply, plus a `dropped` line naming your address | The NAS allowlist refused it: the packet did not come from a router with RADIUS switched on. |

The test packet comes from `127.0.0.1`, which is normally *not* on the allowlist,
so it is dropped and logged. That is the allowlist working, not a fault — but it
means the button cannot distinguish "secret wrong" from "not allowlisted" on its
own. Read the live log line: it says which.

---

## 4. Watch it

Network → **RADIUS Live**. Accepts, rejects, accounting and disconnects, live,
with the health dot at the top.

A healthy first login looks like:

```
accept    rahim100       10.10.0.9   rahim100 accepted on 20M/10M
accounting rahim100      10.10.0.9   rahim100 · 4A2F-119C · Start — session started
accounting rahim100      10.10.0.9   rahim100 · 4A2F-119C · Interim-Update — session alive at 300s
disconnect rahim100      10.10.0.9   rahim100: 1/1 live session(s) disconnected by CoA
```

The rate limit in the accept line is the package's `downloadSpeed/uploadSpeed`.
If it says the router's default profile instead, the MikroTik dictionary did not
load — check the process's boot banner.

---

## Troubleshooting

**Every login rejected, no accepts at all**

Compare the secrets character by character. A trailing space in the MikroTik field
is the usual cause, and the router will not show it. Set it again by pasting, and
check the process banner reports a secret of the expected length.

**Rejected, and the reason in the log is "wrong password"**

The secret is right. The `User-Name` on the router must match the customer's
`username` exactly — case-sensitive. MikroTik's default local login is the
*ppp secret*, not this application's username; if the profile still has
`local=username` set, remove it.

**Every v2 login rejected, with the right password**

Almost always the user name. MS-CHAPv2 mixes the user name into its challenge
hash (RFC 2759 §8.2), so a MikroTik configured with `DOMAIN\user` computes a
different hash than one configured with `user`. This application strips any domain
prefix, so the router and the server agree only if the router's local
authentication is also set to the bare name.

If the log reason is "no supported password attribute", the router offered no
CHAP or MS-CHAPv2 credential at all — check **PPP → Profiles → Use RADIUS** is
ticked on the profile, not only **PPP → AAA**.

**A subscriber is refused because another device is connected**

`radius.simultaneousUse`, default 1. Their account is fine and nothing is wrong
with their line — another session of theirs is already open. Either the second
device is theirs to unplug, or the plan allows more: raise the limit in
**Settings → Network**, or set it to `0` for unlimited on a flat-rate product.
The refusal is deliberately worded differently from the "account suspended" one,
because sending someone to the billing office for a problem in their own house is
the worse mistake.

**Rejected, reason "no such subscriber"**

Same cause, seen from the other end: no customer has that username. It is the
customer's `username` in Customers, not their name or customer code.

**"connection status is Suspended"**

Working as intended. The subscriber is suspended in this application, so RADIUS
refuses them. Suspension is what cuts them off on a RADIUS router — there is no
secret to disable.

**"expired ... past the grace period"**

Also intended. The date and the grace period match what the billing sweep
honours; if it should not have expired, the `expiryDate` is wrong.

**A suspended customer is still online**

They were suspended while connected, and the Disconnect-Request did not land:

1. Is **Accept CoA** set on the router?
2. Is `network.nasCoaPort` pointing at the router and not at this server?
3. Is there accounting for that session? Without an `Acct-Session-Id` from
   accounting there is nothing to address the Disconnect-Request to, and the
   suspension will report no live session. Look for `Start` lines for that user in
   the live log.

**Some logins work, others do not**

Almost always the username. Check for customers whose `username` differs only in
case or has a trailing space — PostgreSQL treats them as different, the router
does not care, and the failure looks random.

**"RADIUS is DOWN" on the dashboard**

The heartbeat is older than a minute. The process is not running. Nothing else in
the application can tell you this: a UDP listener that is not in a conversation
cannot be probed, which is why the process writes a heartbeat row every 15
seconds and the dashboard reads its age.

---

## CoA in detail

A Reject stops the *next* login. It does nothing about the customer who is online
right now, which is the usual case when the office suspends someone. So
suspension also sends an RFC 5176 Disconnect-Request.

It can only do that if the session is known, and it is known only because the
router is sending **accounting**. The Disconnect-Request has to name the router
and the `Acct-Session-Id`, and the only place either exists is the accounting row
the router wrote itself. **Without accounting, suspension cannot drop a live
session** — the row says Done and the customer is still online.

`network.nasCoaPort` is where those packets are sent, per RFC 5176.