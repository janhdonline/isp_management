# Deploying to Vercel + Neon

This takes about twenty minutes and needs a GitHub account, a Vercel account and
a Neon account. All three have a free tier, which is what the numbers below
assume.

The application is already wired for it: `vercel.json` declares the cron job,
`prisma.config.ts` knows which of the two database URLs to use where, and the
build command generates the Prisma client and applies migrations before Next.js
compiles. What is left is configuration.

---

## 1. The database (Neon)

1. Sign in at [console.neon.tech](https://console.neon.tech) and create a
   project. Name it whatever you like; the region is worth picking deliberately
   — pick the one closest to your users, because every page that touches the
   database pays the round trip.
2. Neon immediately offers a **connection string**. Take the **pooled** one. It
   looks like this:

   ```
   postgresql://USER:PASSWORD@ep-cool-name-a1b2c3-pooler.region.aws.neon.tech/ispdb?sslmode=require
   ```

   The `-pooler` in the hostname is the part that matters.

3. Open **Connection details** in the sidebar. You will find two connection
   strings, and they are not interchangeable:

   | URL | Where you find it | Used by |
   | --- | --- | --- |
   | **Pooled** | the default shown after project creation, or "Pooled connection string" | the running application |
   | **Direct** | "Direct connection string" in the connection details panel | `prisma migrate deploy` |

   **Why two.** The application runs as serverless functions, so it opens a lot
   of short-lived connections. Each one held open directly against the database
   would count against the server's connection limit, and a busy hour would
   exhaust it — the site would go down under exactly the load it should be
   handling. The pooled URL routes through a connection pooler that reuses
   connections, which is what serverless needs.

   Migrations need the *direct* URL instead, because a migration runs
   `SET` statements and takes an advisory lock, and a pooler sits between those
   and the database in a way that breaks both. Pointing `migrate deploy` at the
   pooled URL fails with errors that do not mention pooling at all.

   Locally there is no pooler, so both are the same address and none of this
   applies. It only matters once the database is hosted.

---

## 2. The application (Vercel)

1. Go to [vercel.com/new](https://vercel.com/new) and import the repository from
   GitHub. Vercel detects Next.js on its own; leave the framework preset alone.
2. Before the first deploy, open **Settings → Environment Variables** and add
   the variables in the next section. They must be present *before* the build,
   because the build command applies migrations and cannot do so without a
   database URL.
3. Deploy. The first build takes a few minutes — it compiles Next.js and runs
   the migrations.

### Environment variables

| Variable | Where to get it | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Neon → **pooled** connection string | the application |
| `DIRECT_URL` | Neon → **direct** connection string | migrations only, used by the Prisma CLI |
| `AUTH_SECRET` | you generate it — see below | signs session cookies |
| `CRON_SECRET` | you generate it — see below | authorises the cron endpoint |
| `SESSION_COOKIE_SECURE` | `true` | Vercel serves HTTPS |
| `SELF_ADMIN_EMAIL` | optional, e.g. `admin@isp.com` | stops that account's own role being edited, so you cannot lock yourself out |

Generate the two secrets. Do not invent them by hand and do not reuse one for
both:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run it twice and use one result for each. `AUTH_SECRET` **must** be at least 32
characters or the application refuses to start; the check is deliberate, because
this value is what makes a session cookie unforgeable.

Set both for **Production**, **Preview** and **Development**. Vercel treats a
variable as unset rather than empty, so marking it for all three is the whole
job.

> **`SESSION_SECRET` is not a thing here.** If you are copying an env var table
> from somewhere else and it lists `SESSION_SECRET`, ignore it. The variable in
> this codebase is `AUTH_SECRET` — set that one. Setting `SESSION_SECRET` alone
> leaves `AUTH_SECRET` unset, and the application throws on its first request in
> production rather than starting.

### The payment gateway

There is no gateway environment variable, and this is deliberate: the SSLCommerz
store ID and password live in the **Settings** table so they can be changed from
the interface without a redeploy.

For the demo, leave them **blank**. A blank store ID means
`activeGateway()` returns `null`, the "Pay Online" buttons hide themselves, and
the online-payment path stays out of the way entirely. That is the intended
state — it is a real configuration, not a stub pretending to work.

To actually enable it later: **Settings → API**, fill in `sslcommerzStoreId` and
`sslcommerzStorePassword`, and leave `sslcommerzSandbox` on `true` until the
merchant account is live. Also set `app.url` under **Settings → General** to your
Vercel domain, because it is what the customer is redirected back to after
paying, and the default is `http://localhost:3000`.

---

## 3. Seeding the database

Do this **from your own machine**, not from Neon. The seed is a script that
connects with a normal driver, so it runs anywhere — and running it from Neon
would mean shipping a development machine's connection string into their web UI.

```bash
git clone git@github.com:janhdonline/isp_management.git
cd isp_management
npm install

# Point at the Neon database. Use the DIRECT url here: seeding is not a
# migration, so either works, but the direct one avoids a pooler in the way.
echo "DATABASE_URL=postgresql://...-pooler.../ispdb?sslmode=require" > .env
echo "DIRECT_URL=postgresql://...-neon.tech.../ispdb?sslmode=require" >> .env

# At least 32 characters. The seed does not need it, but `npm run setup` runs
# code that reads it, and a missing one is confusing to debug.
echo "AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" >> .env

npx prisma migrate deploy   # create the schema
npm run db:seed             # fill it with demo data
```

`migrate deploy` and the seed are both safe to run more than once. You do not
need `prisma migrate dev` — that command wants an interactive terminal and a
development database, and it is the wrong tool on a server.

The demo credentials the seed prints are in [`docs/DEMO.md`](docs/DEMO.md).

---

## 4. Checking that it works

Four checks, in order. Each one fails in a different way, which is the point of
doing them separately rather than all at once.

**1. The application responds.**

```bash
curl -I https://your-app.vercel.app/login
```

`200` or `307` is correct. A `500` here means the environment variables are
missing — check that `AUTH_SECRET` is set and at least 32 characters.

**2. The cron endpoint refuses an unauthenticated request.**

```bash
curl -i https://your-app.vercel.app/api/cron
```

This must return **`401`**. That is the success condition, and it is worth being
explicit about, because it looks like a failure. If `CRON_SECRET` is not set the
route returns `503` and says so; if the secret *is* set but you sent no token,
`401` is the correct and desired answer. An open endpoint here would raise
invoices and suspend customers on request from anyone.

Visiting that same URL in a browser lists the seven scheduled jobs without
running any of them.

**3. The cron is actually scheduled.** In Vercel, **Settings → Cron Jobs** shows
the job and its last run. Wait fifteen minutes for the first tick.

To run it immediately rather than wait:

```bash
curl -X POST https://your-app.vercel.app/api/cron \
  -H "authorization: Bearer $CRON_SECRET" \
  -H "content-type: application/json" \
  -d '{"reason":"manual check"}'
```

The response lists each job with its duration and row count. Note that Vercel
Cron itself issues a **GET**, not a POST — this route accepts both, with the
same bearer token, because having only one method meant the scheduled path
silently did nothing while returning a healthy response.

**4. Log in.** Open the site, sign in as `admin@isp.com` / `admin123`, and check
the dashboard has numbers on it. An empty dashboard means the seed did not run.

---

## 5. What the free tiers will and will not do

Both free tiers are genuinely usable for a demo. Neither is a production
platform, and the limits are worth knowing before something looks broken.

**Vercel Hobby**

- **Cron runs "best effort".** The schedule is honoured, but under heavy load
  across all of Vercel, a tick can be delayed or skipped. It will not be exactly
  every fifteen minutes, and it may occasionally skip a window entirely. The
  jobs are idempotent, so a skipped run means the work happens on the next tick
  rather than being lost — but invoice generation can drift by a few minutes
  from the exact hour.
- **Cron granularity.** Once a minute is the finest schedule Hobby allows.
  Every fifteen minutes is comfortably inside that.
- **No deployment protection or preview comments** on Hobby.
- Function execution time and memory limits are lower than the paid tiers. The
  heaviest job is the nightly invoice run over the demo dataset, which is a few
  seconds — comfortable, but a genuinely large customer base would outgrow it.

**Neon Free**

- **Autosuspend.** After a period of no activity, Neon scales the compute to
  zero. The next query wakes it, taking roughly half a second. To a visitor this
  looks like a slightly slow first page load; nothing breaks, and nothing is
  lost. Suspend is governed by *compute activity*, not by queries, so a site in
  real use stays awake.
- **Storage.** 0.5 GB per project. The demo dataset uses a few megabytes. Billing
  history grows forever, so on a real deployment this is the limit you will hit
  first — plan on archiving closed invoices.
- **Two projects** on the free tier.

Neither limit is a problem for showing the application to someone. Both are
problems for running it as a business, and the honest way to present that is to
say the free tiers cover a demonstration, and name what production would need
instead.

---

## Troubleshooting

**Build fails with `Environment variable not found: DATABASE_URL`.**
The variables were added after the deployment was created, or only to one
environment. Both URLs must be present on every environment the build runs on.

**Build fails at `prisma migrate deploy` with a connection error.**
`DIRECT_URL` is probably pointed at the pooled endpoint, or is a connection
string that has expired. Neon connection strings do not expire, but a pasted
string can be truncated or carry a stale password.

**`Error: AUTH_SECRET must be at least 32 characters long.`**
The value was truncated, or a placeholder like `secret` was used. Generate a real
one with the command above.

**Sign-in succeeds and then immediately fails.**
Usually a missing or wrong `AUTH_SECRET` causing cookies that do not verify. It
is also worth checking `SESSION_COOKIE_SECURE=true` is actually set — without it
the cookie is issued without the `Secure` flag and browsers drop it over HTTPS.

**Invoices are not being generated.**
Check **Settings → Cron Jobs** in Vercel for the last run, then run the command
in step 3 by hand. A `401` there means `CRON_SECRET` in Vercel and in your shell
disagree.