# BTRC Subscriber Report

The periodic subscriber return filed with the Bangladesh Telecommunication
Regulatory Commission. Built from data the app already holds: Reports → BTRC,
picking a month, then **Export CSV**.

> ⚠️ **The column layout has not been confirmed against BTRC's current prescribed
> format.** BTRC issues the template and it changes between filing periods.
> Confirm every column name, its order and its meaning against the current BTRC
> template before the first real submission. When they differ, change
> `BTRC_COLUMNS` in
> `src/lib/services/btrc.ts` — it is the single source of truth — and this table
> with it. `tests/btrc.test.mjs` asserts the two agree, so the export and the
> documentation cannot drift apart silently.

## Columns

| # | Column | What it is |
|---|--------|------------|
| 1 | Package | The package name, or `No Package` where a customer is not on one |
| 2 | Area | The area name, or `No Area` where none is assigned |
| 3 | Active | Customers with connection status Active in this package/area |
| 4 | Suspended | Customers with connection status Suspended in this package/area |
| 5 | Disconnected | Customers with connection status Disconnected in this package/area |
| 6 | Total Subscribers | Columns 3 + 4 + 5 for the row |
| 7 | New Connections | Customers whose connection date falls in the reported month |
| 8 | Churn | Customers whose disconnection date falls in the reported month |

The layout is declared once, as `BTRC_COLUMNS` in `src/lib/services/btrc.ts`. The
header row, the per-row value order and the filename all come from that constant,
so reordering a column cannot leave the values behind.

Rows are one per package × area that appears in any figure. A pair that holds
nobody today but was connected to during the month still gets a row, because
"churn in an area with no subscribers" is a question the regulator can ask and the
answer has to be a row, not a missing one.

## How each figure is computed

Every subscriber count runs through `buildCustomerWhere` in
`src/lib/services/customers.ts` — the same filter builder the Customers list
applies, and therefore the same predicate `customerStatusMetrics` uses behind the
dashboard cards. There is deliberately no second implementation of "count the
active customers"; one predicate is the only way two screens can be relied on to
agree.

| Figure | Source |
|--------|--------|
| Active / Suspended / Disconnected | `buildCustomerWhere({ status })`, grouped by `packageId` and `areaId` |
| Total Subscribers | The three status columns added together — never a fourth query |
| New Connections | `buildCustomerWhere({ from, to })` over the month, i.e. `connectionDate` inside it |
| Churn | `connectionStatus`-independent filter on `disconnectedAt` inside the month |
| Net change (shown in the UI, not filed) | New Connections − Churn |

Churn is counted from `disconnectedAt`, which the app sets when a customer is
disconnected and clears again on reconnect. A customer disconnected and
reconnected inside the same month therefore appears in neither month's churn. That
is deliberate: it counts departures from service, which is what a regulator's
churn figure is measuring, and not the churn of internal status edits.

### Status counts are a snapshot; new connections and churn are period figures

Columns 3–6 describe the subscriber base **as it stands now**, broken down by the
package and area each customer is currently in. Columns 7–8 describe the selected
month only.

This matters when reading an old month: picking June will show June's connections
and disconnects, but the Active/Suspended/Disconnected split is today's split, not
June's. The app stores current status on the customer and no history of it, so a
true historical status split cannot be produced from this data — only the churn of
status edits is captured, through `disconnectedAt`.

## Reconciling the figures

The report is meant to be defensible, so its numbers must be the same numbers the
operator sees elsewhere. `tests/btrc.test.mjs` checks this against the other call
sites rather than against a copy of the report's own query:

- each status total equals `customerStatusMetrics()` — the function the dashboard
  cards read;
- each status total equals `listCustomers({ status })` — what the Customers list
  shows for that status;
- every individual cell equals `listCustomers({ status, areaId, packageId })`, so a
  wrong cell cannot hide behind a correct total;
- New Connections and Churn equal a direct count over the same month;
- generating and exporting the report leaves the row counts of `Customer`,
  `Package` and `Area` unchanged.

## Empty months

A missing or unparseable month produces an empty report — every figure zero, no
rows, and a CSV that is a header line and nothing else. It is not an error: a
cleared month picker is a normal state, and reporting the wrong month because a
parameter was dropped is the worse failure of the two.

## Access

Read-only. `GET /api/reports/btrc?month=YYYY-MM` requires the `reports.export`
permission, the same check the Excel export endpoint applies, and runs one set of
selects. Generating the report writes nothing.

The service module is `src/lib/services/btrc.ts`; the endpoint is
`src/app/api/reports/btrc/route.ts`; the view is `BtrcReport` in
`src/components/reports/report-views.tsx`.
