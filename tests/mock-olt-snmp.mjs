/**
 * A fake OLT, for testing the SNMP driver (Phase N).
 *
 * ## Why a separate mock rather than another for RouterOS
 *
 * Different protocol, different failure modes, different test. `mock-routeros.mjs` is
 * an HTTP server that answers 401 on bad credentials; this is a UDP agent that
 * either serves its ONU table or does not answer at all. Reusing the HTTP mock would
 * have meant stubbing out the SNMP layer — which is precisely the layer under test:
 * the subtree walk, the slot correlation between four columns, and the rule that
 * 9999 is "no reading" rather than a light level.
 *
 * It is built on `net-snmp`'s own `createAgent`, so the packets are real SNMP and
 * the driver talks to a genuine implementation of the protocol rather than a
 * hand-rolled imitation that would agree with whatever the driver happens to do.
 *
 * ## The table is one provider, not four
 *
 * The driver's four OIDs — serial, rx, tx, status — are columns of the same table,
 * and the mock registers them as one `MibProviderType.Table` provider over their
 * common prefix. That matters for the test's honesty: the driver correlates the
 * four walks **by the index in the OID suffix**, not by row order, because row
 * order is a real thing to get wrong and a mock that returned them in a neat
 * matching order would never catch it.
 *
 * ## Command line
 *
 *   node tests/mock-olt-snmp.mjs
 *
 * Starts an agent, prints its address and community, and serves four ONUs — three
 * plausible and one serial we do not recognise, which is what a self-installed ONU
 * looks like from the OLT's side. Ctrl-C to stop.
 */

import snmp from "net-snmp";

/**
 * Four ONUs on one cabinet.
 *
 * `UNKNOWN1` is the interesting one: on the OLT and in no database. The powers are
 * deliberately varied — clean, marginal, and a pair of sentinels — because "the sync
 * copied the right number to the right row" is only a meaningful assertion when a
 * shuffled row would be detectable.
 */
export const DEFAULT_ONUS = [
  { slot: 1, serialNo: "HWTC00000001", rxPower: -18.4, txPower: 2.1, state: 2 },
  { slot: 2, serialNo: "HWTC00000002", rxPower: -27.9, txPower: 1.8, state: 3 },
  { slot: 3, serialNo: "HWTC00000003", rxPower: -22.05, txPower: 2.4, state: 2 },
  // Every vendor's "no reading". A driver that stores 9999 as a level makes an ONU
  // that has never transmitted look impossibly healthy, and the low-signal alert
  // then never fires for it.
  { slot: 4, serialNo: "UNKNOWN1", rxPower: 9999, txPower: -9999, state: 1 },
];

export const DEFAULT_OIDS = {
  onuBase: "1.3.6.1.4.1.2011.2.25.188",
  onuSerial: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.2",
  rxPower: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.6",
  txPower: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.7",
  status: "1.3.6.1.4.1.2011.2.25.188.1.4.2.1.5",
  ponBase: "1.3.6.1.4.1.2011.2.25.188.1.3.6.1.2",
};

/**
 * The table base and column numbers behind the four leaf OIDs.
 *
 * Derived rather than hardcoded, because the OID map is *configuration* in this
 * application — a mock that assumed the shipped default would silently stop
 * testing anything the moment somebody overrode an OID.
 */
export function tableShape(oids) {
  const leaves = [
    ["serialNo", oids.onuSerial],
    ["rxPower", oids.rxPower],
    ["txPower", oids.txPower],
    ["status", oids.status],
  ].map(([field, oid]) => ({ field, parts: String(oid).trim().split(".") }));

  // A leaf column OID is `base.<column>`; a walk appends `.<index>` to it. So the
  // table base is the common prefix with the **last** component removed, and the
  // column number is that last component.
  //
  // The obvious reading — column is second-to-last — is wrong, and wrong in a way
  // that looks right: `...1.4.2.1.2` has a 1 in both positions, so taking the
  // second-to-last quietly produces four columns all numbered 1, the row collapses
  // to one cell, and the agent refuses to start.
  const base = leaves.reduce((acc, { parts }) => {
    const prefix = parts.slice(0, -1);
    const out = [];
    for (let i = 0; i < Math.min(acc.length, prefix.length); i++) {
      if (acc[i] !== prefix[i]) break;
      out.push(acc[i]);
    }
    return out;
  }, leaves[0].parts.slice(0, -1));

  return {
    base: base.join("."),
    columns: leaves.map(({ field, parts }) => ({
      number: Number(parts[parts.length - 1]),
      field,
    })),
  };
}

let portCursor = 21000 + Math.floor(Math.random() * 8000);

/**
 * Starts a fake OLT.
 *
 * `silent: true` makes it stop answering altogether, which is how a timeout is
 * tested. The difference between "the driver could not reach the OLT" and "the
 * driver reached it and it had nothing to say" is the difference between an outage
 * and a misconfigured OID map, and only one of them may touch the database.
 *
 * A fixed port rather than an ephemeral one, because `createAgent` does not report
 * the port it bound: `port: 0` is ignored and the agent listens on 161, which in a
 * container without privileges is a failure rather than a convenience. So a port is
 * picked from a random high range and stepped forward on conflict.
 */
export async function startMockOlt({
  community = "public",
  onus = DEFAULT_ONUS,
  oids = DEFAULT_OIDS,
  silent = false,
} = {}) {
  let table = onus.map((o) => ({ ...o }));
  let responding = !silent;
  const writes = [];
  const shape = tableShape(oids);

  let agent = null;
  let port = portCursor++;

  function build() {
    const created = snmp.createAgent({
      port,
      community,
      version: snmp.Version2c,
    });
    const mib = created.getMib();

    mib.registerProvider({
      name: "onuTable",
      type: snmp.MibProviderType.Table,
      oid: shape.base,
      maxAccess: snmp.MaxAccess["not-accessible"],
      tableColumns: [
        // Column 1 is a row identifier the vendor OIDs do not use, so the table
        // has an index of its own. Real MIBs have one; without it net-snmp has
        // nothing to key rows on.
        { number: 1, name: "onuIndex", type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess["read-only"] },
        ...shape.columns.map((c) => ({
          number: c.number,
          name: c.field,
          // Power and state go out as OctetString, which is what a vendor agent
          // does: these are "display" values carried in a string column, and the
          // driver parses them. Sending them as real integers would be a nicer
          // protocol than the one being tested.
          type: snmp.ObjectType.OctetString,
          maxAccess: c.field === "serialNo" ? snmp.MaxAccess["read-write"] : snmp.MaxAccess["read-only"],
        })),
      ],
      tableIndex: [{ columnName: "onuIndex" }],
      handler: (mibRequest) => {
        if (!responding) return; // Never completed: the client's timeout fires.
        mibRequest.done();
      },
    });

    for (const row of table) addRow(mib, row);

    const pon = created.getMib();
    pon.registerProvider({
      name: "ponTable",
      type: snmp.MibProviderType.Table,
      oid: oids.ponBase,
      maxAccess: snmp.MaxAccess["not-accessible"],
      tableColumns: [
        { number: 1, name: "ponIndex", type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess["read-only"] },
        { number: 2, name: "ponPresent", type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess["read-only"] },
      ],
      tableIndex: [{ columnName: "ponIndex" }],
      handler: (mibRequest) => {
        if (!responding) return;
        mibRequest.done();
      },
    });
    for (const row of table) {
      pon.addTableRow("ponTable", [row.slot, 1]);
    }

    return created;
  }

  function addRow(mib, row) {
    const cells = new Map();
    for (const c of shape.columns) {
      cells.set(c.number, String(row[c.field] ?? ""));
    }
    // Values in ascending column order, which is what `addTableRow` expects.
    const ordered = [row.slot, ...[...cells.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)];
    mib.addTableRow("onuTable", ordered);
  }

  async function open() {
    let lastError = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        agent = build();
        if (lastError) lastError = null;
        return;
      } catch (e) {
        lastError = e;
        port = portCursor++;
        agent = null;
      }
    }
    throw new Error(
      `could not start a fake OLT on any port: ${lastError instanceof Error ? lastError.message : String(lastError)}`
    );
  }

  await open();

  return {
    port,
    host: "127.0.0.1",
    url: `snmp://127.0.0.1:${port}`,
    community,
    oids,
    shape,
    serials: () => table.map((o) => o.serialNo),
    onus: () => table.map((o) => ({ ...o })),
    /** Adds or replaces one ONU, and rebuilds the agent's table. */
    async setOnu(row) {
      const at = table.findIndex((o) => o.slot === row.slot);
      if (at === -1) table.push({ ...row });
      else table[at] = { ...table[at], ...row };
      await restart();
    },
    async removeOnu(serialNo) {
      table = table.filter((o) => o.serialNo !== serialNo);
      await restart();
    },
    /**
     * Stops answering. The socket is closed, not merely muted, so the client's own
     * timeout fires — which is the case that must not touch the database.
     */
    async goSilent(value = true) {
      responding = !value;
      if (value) {
        const current = agent;
        agent = null;
        await new Promise((r) => current.close(r));
      } else {
        await open();
      }
    },
    writes: () => writes.slice(),
    reset: async () => {
      table = onus.map((o) => ({ ...o }));
      responding = !silent;
      writes.length = 0;
      await restart();
    },
    close: () =>
      new Promise((r) => {
        if (!agent) return r();
        const current = agent;
        agent = null;
        current.close(r);
      }),
  };

  async function restart() {
    if (!agent) return;
    const current = agent;
    agent = null;
    await new Promise((r) => current.close(r));
    await open();
  }
}

/* ------------------------------------------------------------------ */
/* Command line                                                        */
/* ------------------------------------------------------------------ */

const invokedDirectly =
  !!process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (invokedDirectly) {
  const olt = await startMockOlt();
  console.log(`Fake OLT listening on snmp://${olt.host}:${olt.port}`);
  console.log(`  community  ${olt.community}`);
  console.log(`  vendor     snmp-huawei`);
  console.log("  ONUs");
  for (const o of olt.onus()) {
    console.log(`    slot ${o.slot}  ${o.serialNo}  rx=${o.rxPower}  tx=${o.txPower}  state=${o.state}`);
  }
  console.log(
    `\nSet an OLT row to ${olt.host}:${olt.port}, community "${olt.community}", vendor snmp-huawei,`
  );
  console.log(`snmp port ${olt.port}, and tick the SNMP community box.`);
  console.log("\nUNKNOWN1 is on the OLT and in no database — that is the rogue case.");
  console.log("\nCtrl-C to stop.");
}