/**
 * Development seed: creates roles, users, reference data and a realistic
 * 90-day history of customers, invoices, payments and sessions so every page
 * in the app has real rows to render.
 *
 * Run with:  npx prisma db seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrl } from "../src/lib/db-url";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { buildPermissionKeys, ROLE_GRANT_RULES } from "../src/lib/permissions";

const adapter = new PrismaPg({ connectionString: databaseUrl() });
const prisma = new PrismaClient({ adapter });

// --- deterministic pseudo-random so reseeding is reproducible -------------
let seed = 20260927;
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)];
const between = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const chance = (p: number) => rnd() < p;

const DAY = 86400000;
const startOfDay = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function reset() {
  // Children before parents, so the foreign keys always resolve.
  const names = [
    "ActivityLog", "Receipt", "Payment", "Invoice", "OnlineSession",
    "CustomerPackageChange", "Notification", "TicketComment", "Ticket",
    "Attendance", "Leave", "Salary", "Employee", "Onu", "Olt", "Router",
    "Expense", "AccountTransaction", "AccountTransfer",
    "Account", "Customer", "Package", "Area", "Zone",
    "RolePermission", "Permission", "Role", "User", "Backup",
    "SmsCredit", "Counter", "Setting",
  ];
  for (const name of names) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${name}"`);
  }
}


async function seedRolesAndUsers() {
  const permissions = buildPermissionKeys();
  for (const p of permissions) {
    await prisma.permission.create({ data: p });
  }

  // The grants come from ROLE_GRANT_RULES rather than three hand-written lists,
  // so this and scripts/sync-permissions.mjs cannot drift apart.
  const grantsFor = (roleName: string) =>
    permissions
      .filter((p) => ROLE_GRANT_RULES[roleName]?.(p))
      .map((p) => ({ permission: { connect: { key: p.key } } }));

  const adminRole = await prisma.role.create({
    data: {
      name: "Administrator",
      description: "Full access to every module",
      isSystem: true,
      permissions: { create: grantsFor("Administrator") },
    },
  });

  const managerRole = await prisma.role.create({
    data: {
      name: "Account Manager",
      description: "Customers, billing and accounts",
      isSystem: true,
      permissions: { create: grantsFor("Account Manager") },
    },
  });

  const techRole = await prisma.role.create({
    data: {
      name: "Technician",
      description: "Network monitoring and support tickets",
      isSystem: true,
      permissions: { create: grantsFor("Technician") },
    },
  });

  const users = [
    { name: "System Administrator", email: "admin@isp.com", password: "admin123", roleId: adminRole.id },
    { name: "Rakib Hasan", email: "manager@isp.com", password: "manager123", roleId: managerRole.id },
    { name: "Sadia Islam", email: "tech@isp.com", password: "tech123", roleId: techRole.id },
  ];

  for (const u of users) {
    await prisma.user.create({
      data: {
        name: u.name,
        email: u.email,
        phone: "+880 1711 000000",
        passwordHash: await bcrypt.hash(u.password, 10),
        roleId: u.roleId,
        status: "Active",
        lastLoginAt: addDays(new Date(), -1),
      },
    });
  }

  return { adminId: (await prisma.user.findUniqueOrThrow({ where: { email: "admin@isp.com" } })).id,
    managerId: (await prisma.user.findUniqueOrThrow({ where: { email: "manager@isp.com" } })).id,
    techId: (await prisma.user.findUniqueOrThrow({ where: { email: "tech@isp.com" } })).id };
}

async function seedSettings() {
  for (const s of DEFAULT_SETTINGS) {
    await prisma.setting.create({
      data: { key: s.key, value: s.value, group: s.group, isSecret: !!s.isSecret },
    });
  }
}

const ZONES = [
  { name: "North City", description: "Northern part of the city" },
  { name: "South City", description: "Southern part of the city" },
  { name: "Old Town", description: "Legacy coverage area" },
];

const AREA_NAMES = [
  "Uttara Sector 1", "Uttara Sector 2", "Mirpur 10", "Mirpur 11", "Bashundhara Residential",
  "Banani", "Gulshan 1", "Gulshan 2", "Dhanmondi 27", "Mohammadpur",
  "Lalmatia", "Shyamoli", "Pallabi", "Mirpur DOHS", "Kafrul",
];

const PKG_DEFS = [
  { name: "Home Basic 5", downloadSpeed: 5, uploadSpeed: 1, monthlyPrice: 500, installationFee: 500, validityDays: 30, fupLimit: null },
  { name: "Home Basic 10", downloadSpeed: 10, uploadSpeed: 2, monthlyPrice: 800, installationFee: 500, validityDays: 30, fupLimit: null },
  { name: "Home Standard 20", downloadSpeed: 20, uploadSpeed: 4, monthlyPrice: 1200, installationFee: 600, validityDays: 30, fupLimit: null },
  { name: "Home Plus 30", downloadSpeed: 30, uploadSpeed: 6, monthlyPrice: 1600, installationFee: 800, validityDays: 30, fupLimit: 500 },
  { name: "Business 50", downloadSpeed: 50, uploadSpeed: 10, monthlyPrice: 2800, installationFee: 1500, validityDays: 30, fupLimit: 1000 },
  { name: "Corporate 100", downloadSpeed: 100, uploadSpeed: 20, monthlyPrice: 5500, installationFee: 3000, validityDays: 30, fupLimit: null },
  { name: "Gaming Low Ping 40", downloadSpeed: 40, uploadSpeed: 40, monthlyPrice: 3200, installationFee: 1200, validityDays: 30, fupLimit: 800 },
  { name: "Student 8", downloadSpeed: 8, uploadSpeed: 1, monthlyPrice: 600, installationFee: 400, validityDays: 30, fupLimit: 100 },
  { name: "Home Pro 25", downloadSpeed: 25, uploadSpeed: 5, monthlyPrice: 1400, installationFee: 700, validityDays: 30, fupLimit: null },
  { name: "Wholesale 200", downloadSpeed: 200, uploadSpeed: 40, monthlyPrice: 12000, installationFee: 5000, validityDays: 30, fupLimit: null },
];

const FIRST_NAMES = ["Ahmed","Rahim","Karim","Nasir","Jahangir","Shahriar","Rubel","Tanvir","Fahim","Imran","Sadia","Nusrat","Farhana","Tahmina","Rupa","Shamima","Joya","Nabila","Reshma","Lamia","Arif","Bashir","Habib","Mizan","Sohel","Rasel","Anwar","Jamal","Kamal","Ripon"];
const LAST_NAMES = ["Hasan","Rahman","Islam","Ahmed","Uddin","Hossain","Miah","Khan","Chowdhury","Bhuiyan","Sarkar","Das","Roy","Barua","Talukder","Molla","Biswas","Ghosh","Sikder","Alam"];

const STREETS = ["Road 5, Block C", "House 42, Lane 3", "Flat 5B, Mirpur DOHS", "Plot 19, Sector 4", "House 7, Green Road"];

async function seedReference() {
  const zones = [];
  for (const z of ZONES) {
    zones.push(await prisma.zone.create({ data: z }));
  }
  const areas = [];
  for (let i = 0; i < AREA_NAMES.length; i++) {
    areas.push(
      await prisma.area.create({
        data: {
          name: AREA_NAMES[i],
          code: `AR-${String(i + 1).padStart(3, "0")}`,
          zoneId: zones[i % zones.length].id,
          status: i === AREA_NAMES.length - 1 ? "Inactive" : "Active",
        },
      })
    );
  }

  const packages = [];
  for (const p of PKG_DEFS) {
    packages.push(
      await prisma.package.create({
        data: {
          ...p,
          billingCycle: "Monthly",
          description: `${p.downloadSpeed} Mbps down / ${p.uploadSpeed} Mbps up`,
          status: "Active",
        },
      })
    );
  }
  // one inactive package so the status cards have both values
  await prisma.package.create({
    data: {
      name: "Legacy 3 (retired)",
      downloadSpeed: 3,
      uploadSpeed: 0.5,
      monthlyPrice: 350,
      installationFee: 300,
      validityDays: 30,
      billingCycle: "Monthly",
      status: "Inactive",
    },
  });

  const accounts = [];
  for (const a of [
    { name: "Cash in Hand", type: "Cash", openingBalance: 2_500_000 },
    { name: "Bank - Current Account", type: "Bank", openingBalance: 12_000_000 },
    { name: "bKash Merchant", type: "bKash", openingBalance: 1_800_000 },
    { name: "Nagad Merchant", type: "Nagad", openingBalance: 900_000 },
    { name: "Rocket Merchant", type: "Rocket", openingBalance: 400_000 },
  ]) {
    accounts.push(await prisma.account.create({ data: { ...a, currentBalance: a.openingBalance, status: "Active" } }));
  }
  const cash = accounts.find((a) => a.type === "Cash")!;
  const bank = accounts.find((a) => a.type === "Bank")!;
  const bkash = accounts.find((a) => a.type === "bKash")!;
  const nagad = accounts.find((a) => a.type === "Nagad")!;
  const rocket = accounts.find((a) => a.type === "Rocket")!;

  const routers = [];
  for (const r of [
    { name: "Core-R1", model: "CCR2004-1G-12S+2XS", ipAddress: "10.10.0.2", location: "Core DC, Level 3", areaId: areas[9].id },
    { name: "Edge-Banani", model: "RB4011iGS+", ipAddress: "10.10.1.2", location: "Banani POP", areaId: areas[5].id },
    { name: "Edge-Gulshan", model: "RB5009UG+S+", ipAddress: "10.10.2.2", location: "Gulshan POP", areaId: areas[7].id },
    { name: "Edge-Mirpur", model: "RB4011iGS+", ipAddress: "10.10.3.2", location: "Mirpur 10 POP", areaId: areas[3].id },
    { name: "Edge-Uttara", model: "RB5009UG+S+", ipAddress: "10.10.4.2", location: "Uttara Sector 1 POP", areaId: areas[0].id },
    { name: "Edge-Dhanmondi", model: "RB4011iGS+", ipAddress: "10.10.5.2", location: "Dhanmondi POP", areaId: areas[8].id },
  ]) {
    routers.push(
      await prisma.router.create({
        data: {
          ...r,
          apiPort: 8728,
          apiUser: "isp-api",
          apiSecretEnc: null,
          useSsl: false,
          status: "Unknown",
          areaId: r.areaId ?? null,
        },
      })
    );
  }

  const olts = [];
  for (const o of [
    { name: "OLT-North", vendor: "Huawei", model: "MA5800-X7", ipAddress: "10.20.1.1", location: "Uttara Exchange", areaId: areas[0].id, ponPorts: 16 },
    { name: "OLT-Central", vendor: "Huawei", model: "MA5800-X15", ipAddress: "10.20.2.1", location: "Gulshan Exchange", areaId: areas[6].id, ponPorts: 32 },
    { name: "OLT-South", vendor: "ZTE", model: "C620", ipAddress: "10.20.3.1", location: "Mohammadpur Exchange", areaId: areas[9].id, ponPorts: 24 },
  ]) {
    olts.push(
      await prisma.olt.create({
        data: { ...o, areaId: o.areaId ?? null, status: "Unknown" },
      })
    );
  }

  const onus: string[] = [];
  for (const olt of olts) {
    for (let i = 0; i < between(6, 14); i++) {
      const serial = `HWTC${between(100000, 999999)}${between(1000, 9999)}`;
      onus.push(serial);
      const rx = between(-32, -14) + rnd() * 0.9;
      const status = rx < -28 ? "Low Signal" : chance(0.78) ? "Online" : "Offline";
      await prisma.onu.create({
        data: {
          serialNo: serial,
          name: `ONU-${serial.slice(-4)}`,
          vendor: olt.vendor,
          oltId: olt.id,
          areaId: olt.areaId,
          ponIndex: `0/${between(0, 7)}/${between(0, 3)}:${between(1, 8)}`,
          rxPower: round2(rx),
          txPower: round2(between(2, 8) * -0.1),
          status,
          lastSeenAt: status === "Online" ? addDays(new Date(), 0) : addDays(new Date(), -between(1, 9)),
        },
      });
    }
  }

  const employees = [];
  for (const e of [
    { name: "Sadia Islam", role: "Field Technician", areaId: areas[6].id },
    { name: "Ripon Mia", role: "Field Technician", areaId: areas[3].id },
    { name: "Mizanur Rahman", role: "Network Engineer", areaId: areas[9].id },
    { name: "Jahangir Alam", role: "Support Agent", areaId: areas[0].id },
    { name: "Nusrat Jahan", role: "Accountant", areaId: areas[8].id },
  ]) {
    employees.push(
      await prisma.employee.create({
        data: {
          employeeCode: `EMP-${String(employees.length + 1).padStart(4, "0")}`,
          name: e.name,
          role: e.role,
          phone: `+880 17${between(10, 19)} ${between(100000, 999999)}`,
          email: `${e.name.toLowerCase().replace(/\s+/g, ".")}@netlink.com.bd`,
          areaId: e.areaId,
          joiningDate: addDays(new Date(), -between(120, 900)),
          status: "Active",
        },
      })
    );
  }

  await prisma.smsCredit.create({ data: { balance: 4820, sent: 0, failed: 0 } });

  return { zones, areas, packages, accounts, routers, olts, onus, employees, cash, bank, bkash, nagad, rocket };
}

type Ref = Awaited<ReturnType<typeof seedReference>>;

async function seedBilling(ref: Ref, userIds: { adminId: string; managerId: string }) {
  const now = new Date();
  const accountFor = (method: string) =>
    method === "Cash" ? ref.cash
    : method === "bKash" ? ref.bkash
    : method === "Nagad" ? ref.nagad
    : method === "Bank" ? ref.bank
    : ref.rocket;

  const balances: Record<string, number> = Object.fromEntries(ref.accounts.map((a) => [a.id, a.currentBalance]));
  let invoiceSeq = 0;
  let paymentSeq = 0;
  let receiptSeq = 0;
  let customerSeq = 0;

  // create 180 customers spread over the last 9 months
  const customers: {
    id: string;
    name: string;
    username: string;
    phone: string;
    packageId: string;
    monthlyBill: number;
    connectionDate: Date;
    expiryDate: Date;
    connectionStatus: string;
  }[] = [];

  for (let i = 0; i < 180; i++) {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    const name = `${first} ${last}`;
    const pkg = pick(ref.packages);
    const area = pick(ref.areas);
    const router = pick(ref.routers);
    const connectionDate = addDays(now, -between(5, 270));
    customerSeq += 1;
    const customerCode = `CUS-${String(customerSeq).padStart(6, "0")}`;
    const username = `${first.toLowerCase()}${customerSeq}`;
    const phone = `01${between(3, 9)}${between(10, 19)}${between(100000, 999999)}`;

    // lifecycle distribution
    const ageDays = (now.getTime() - connectionDate.getTime()) / DAY;
    let connectionStatus = "Active";
    const roll = rnd();
    if (roll > 0.95) connectionStatus = "Disconnected";
    else if (roll > 0.88) connectionStatus = "Suspended";
    else if (ageDays < 20 && roll > 0.8) connectionStatus = "Pending";

    // most customers pay on time; some expire, some owe money
    let expiryDate = addDays(connectionDate, 30);
    while (expiryDate < now) {
      expiryDate = addDays(expiryDate, 30);
    }
    const stillOwing = chance(0.26);
    if (stillOwing) {
      const lapses = between(1, 3);
      expiryDate = addDays(expiryDate, -30 * lapses);
    }

    const discount = chance(0.12) ? between(50, 300) : 0;
    const monthlyBill = pkg.monthlyPrice;

    const created = await prisma.customer.create({
      data: {
        customerCode,
        name,
        fatherName: `${pick(FIRST_NAMES)} ${last}`,
        phone,
        altPhone: chance(0.3) ? `01${between(3, 9)}${between(10, 19)}${between(100000, 999999)}` : null,
        email: chance(0.2) ? `${username}@example.com` : null,
        nid: chance(0.5) ? String(between(1000000000, 9999999999)) : null,
        dateOfBirth: chance(0.4) ? new Date(1980, between(0, 11), between(1, 28)) : null,
        gender: chance(0.5) ? "Male" : "Female",
        address: `${pick(STREETS)}, ${area.name}`,
        areaId: area.id,
        customerType: pkg.monthlyPrice > 4000 ? "Business" : "Home",
        username,
        password: "changeme",
        connectionType: "PPPoE",
        packageId: pkg.id,
        ipType: chance(0.15) ? "Static" : "Dynamic",
        ipAddress: `100.64.${between(1, 20)}.${between(2, 250)}`,
        macAddress: Array.from({ length: 6 }, () => between(0, 255).toString(16).padStart(2, "0").toUpperCase()).join(":"),
        routerId: router.id,
        oltId: pick(ref.olts).id,
        connectionDate,
        billingDate: addDays(connectionDate, 30),
        expiryDate,
        monthlyBill,
        installationFee: pkg.installationFee,
        previousDue: 0,
        discount,
        vat: 0,
        connectionStatus,
        billingStatus: "Unpaid",
        onlineStatus: "Offline",
        suspendReason: connectionStatus === "Suspended" ? "Unpaid bill for more than 7 days" : null,
        suspendedAt: connectionStatus === "Suspended" ? addDays(now, -between(1, 20)) : null,
        disconnectReason: connectionStatus === "Disconnected" ? "Customer moved out of service area" : null,
        disconnectedAt: connectionStatus === "Disconnected" ? addDays(now, -between(1, 60)) : null,
        lastOnlineAt: addDays(now, -between(0, 6)),
        createdById: userIds.managerId,
        note: chance(0.15) ? "Installed via field visit" : null,
      },
    });

    customers.push({
      id: created.id,
      name,
      username,
      phone,
      packageId: pkg.id,
      monthlyBill,
      connectionDate,
      expiryDate,
      connectionStatus,
    });

    // --- invoices + payments history ---
    const cycles = Math.min(9, Math.max(1, Math.floor((now.getTime() - connectionDate.getTime()) / DAY / 30)));
    for (let c = 0; c < cycles; c++) {
      const issueDate = addDays(connectionDate, c * 30);
      if (issueDate > now) break;
      const discount = chance(0.1) ? between(50, 200) : 0;
      const total = round2(Math.max(0, monthlyBill - discount));
      invoiceSeq += 1;
      const invoiceNumber = `INV-${String(invoiceSeq).padStart(6, "0")}`;
      const isCurrent = c === cycles - 1;
      const unpaid = isCurrent ? stillOwing : chance(0.08);
      const dueDate = addDays(issueDate, 5);

      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          customerId: created.id,
          packageId: pkg.id,
          issueDate,
          dueDate,
          amount: monthlyBill,
          discount,
          vat: 0,
          total,
          paid: 0,
          status: unpaid ? (dueDate < now ? "Overdue" : "Due") : "Paid",
          createdById: userIds.managerId,
        },
      });

      if (!unpaid) {
        const method = pick(["Cash", "Cash", "Cash", "bKash", "bKash", "Nagad", "Bank"]);
        const account = accountFor(method);
        const paidAt = addDays(issueDate, between(-1, 6));
        const date = paidAt > now ? now : paidAt;
        paymentSeq += 1;
        const paymentId = `PAY-${String(paymentSeq).padStart(6, "0")}`;
        balances[account.id] = round2(balances[account.id] + total);

        const payment = await prisma.payment.create({
          data: {
            paymentId,
            customerId: created.id,
            invoiceId: invoice.id,
            amount: total,
            method,
            accountId: account.id,
            transactionId: method === "Cash" ? null : `TXN${between(100000, 999999)}`,
            collectedById: chance(0.6) ? userIds.managerId : userIds.adminId,
            paymentDate: date,
          },
        });
        receiptSeq += 1;
        await prisma.receipt.create({
          data: {
            receiptNumber: `RCP-${String(receiptSeq).padStart(6, "0")}`,
            paymentId: payment.id,
            invoiceId: invoice.id,
            amount: total,
            method,
            status: "Paid",
            issuedAt: date,
          },
        });
        await prisma.accountTransaction.create({
          data: {
            accountId: account.id,
            type: "Payment",
            direction: "Credit",
            amount: total,
            description: `Payment from ${name} for invoice ${invoiceNumber}`,
            reference: paymentId,
            paymentId: payment.id,
            userId: userIds.managerId,
            balance: balances[account.id],
            date,
          },
        });
        await prisma.invoice.update({ where: { id: invoice.id }, data: { paid: total, status: "Paid" } });
      }
    }

    // online state + traffic
    if (connectionStatus === "Active" && chance(0.42)) {
      const loginTime = new Date(now.getTime() - between(10, 900) * 60000);
      await prisma.customer.update({
        where: { id: created.id },
        data: {
          onlineStatus: "Online",
          loginTime,
          lastOnlineAt: loginTime,
          downloadBytes: BigInt(between(2_000_000, 900_000_000)),
          uploadBytes: BigInt(between(500_000, 180_000_000)),
        },
      });
      await prisma.onlineSession.create({
        data: {
          customerId: created.id,
          username,
          ipAddress: `100.64.${between(1, 20)}.${between(2, 250)}`,
          macAddress: Array.from({ length: 6 }, () => between(0, 255).toString(16).padStart(2, "0").toUpperCase()).join(":"),
          routerId: router.id,
          loginTime,
          downloadBytes: BigInt(between(2_000_000, 900_000_000)),
          uploadBytes: BigInt(between(500_000, 180_000_000)),
        },
      });
    }
  }

  // sync account balances with the ledger
  for (const a of ref.accounts) {
    await prisma.account.update({ where: { id: a.id }, data: { currentBalance: balances[a.id] } });
  }

  return { customers };
}

async function seedTickets(ref: Ref, customers: Awaited<ReturnType<typeof seedBilling>>["customers"], userIds: { techId: string; managerId: string }) {
  const problems = [
    ["No Internet", "No internet since morning", "Customer reports complete loss of connectivity since 08:00."],
    ["Slow Internet", "Very slow speed", "Speed test shows 1 Mbps on a 20 Mbps package during peak hours."],
    ["Router Problem", "Router keeps blinking", "ONT/ONU LOS light is blinking red continuously."],
    ["ONU Problem", "ONU not registering", "ONU shows OFF state and cannot register with the OLT."],
    ["Cable Problem", "Line cut near pole", "Fibre drop cable damaged during road work."],
    ["Payment Problem", "Payment not reflected", "Customer paid via bKash but the portal still shows due."],
    ["Package Problem", "Wrong package active", "Customer upgraded to 30 Mbps but is provisioned on 20 Mbps."],
  ] as const;

  let seq = 0;
  for (let i = 0; i < 48; i++) {
    const c = pick(customers);
    const [category, subject, description] = pick(problems);
    seq += 1;
    const status = pick(["Open", "Open", "Pending", "In Progress", "In Progress", "Resolved", "Closed"] as const);
    const created = addDays(now(), -between(0, 45));
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-${String(seq).padStart(6, "0")}`,
        customerId: c.id,
        areaId: pick(ref.areas).id,
        packageId: c.packageId,
        subject,
        problem: category,
        description,
        category,
        priority: pick(["Low", "Medium", "Medium", "High", "Critical"] as const),
        status,
        technicianId: chance(0.8) ? pick(ref.employees).id : null,
        createdById: userIds.managerId,
        createdAt: created,
        resolvedAt: status === "Resolved" || status === "Closed" ? addDays(created, 1) : null,
        closedAt: status === "Closed" ? addDays(created, 2) : null,
      },
    });
    await prisma.ticketComment.create({
      data: {
        ticketId: ticket.id,
        authorName: "Sadia Islam",
        body: "Technician assigned and initial diagnosis shared with the customer.",
        isInternal: chance(0.4),
        createdAt: addDays(created, 0),
      },
    });
  }
}

function now() {
  return new Date();
}

/** Picks a random account that still has enough balance to cover `amount`. */
async function pickFundedAccount(ref: Ref, amount: number) {
  const rows = await prisma.account.findMany({
    where: { currentBalance: { gte: amount * 3 } },
    orderBy: { name: "asc" },
  });
  if (rows.length === 0) return null;
  return pick(rows);
}

async function seedExpenses(ref: Ref, userIds: { adminId: string; managerId: string }) {
  const entries = [
    ["Bandwidth Purchase", "Upstream transit top-up - 1Gbps", "Ahsan Networks", 85000],
    ["Network Equipment", "SFP+ optics x4", "TechWorld Ltd", 42000],
    ["Utility Bill", "Electricity bill - core DC", "DPDC", 18500],
    ["Salary", "Staff salary disbursement", null, 320000],
    ["Maintenance", "Fiber cable replacement", "Local vendor", 12300],
    ["Transport", "Technician fuel and travel", null, 6800],
    ["Marketing", "Facebook ad campaign", "Meta", 15000],
    ["Rent", "Office rent", "Landlord", 45000],
    ["Tax & License", "Trade license renewal", "City Corporation", 9500],
    ["Office Supplies", "Printer toner and stationery", null, 2400],
  ] as const;

  for (let d = 90; d >= 0; d--) {
    const count = between(0, 3);
    for (let i = 0; i < count; i++) {
      const [category, description, vendor, baseAmount] = pick(entries);
      const amount = round2(baseAmount * (0.85 + rnd() * 0.35));
      // only pay from an account that can actually cover the amount, so no
      // wallet is ever driven negative by the demo data
      const account = await pickFundedAccount(ref, amount);
      if (!account) continue;
      const date = addDays(new Date(), -d);
      const expense = await prisma.expense.create({
        data: {
          category,
          amount,
          date,
          accountId: account.id,
          vendor,
          reference: `REF-${between(10000, 99999)}`,
          description,
          createdById: chance(0.5) ? userIds.adminId : userIds.managerId,
        },
      });
      const current = await prisma.account.findUniqueOrThrow({ where: { id: account.id } });
      const balance = round2(current.currentBalance - amount);
      await prisma.account.update({ where: { id: account.id }, data: { currentBalance: balance } });
      await prisma.accountTransaction.create({
        data: {
          accountId: account.id,
          type: "Expense",
          direction: "Debit",
          amount,
          description: `${category} - ${description}`,
          reference: expense.id,
          expenseId: expense.id,
          userId: userIds.adminId,
          balance,
          date,
        },
      });
    }
  }
}

async function seedNotifications(ref: Ref, customers: Awaited<ReturnType<typeof seedBilling>>["customers"], userIds: { adminId: string }) {
  const templates = [
    "Dear {name}, your bill is due. Please pay ৳{amount} to keep your service active.",
    "Dear {name}, your subscription expires on {date}. Renew now to avoid interruption.",
    "Dear {name}, we have received your payment of ৳{amount}. Thank you.",
  ];
  for (let i = 0; i < 40; i++) {
    const c = pick(customers);
    const tpl = pick(templates);
    const sent = chance(0.9);
    await prisma.notification.create({
      data: {
        channel: pick(["SMS", "SMS", "SMS", "Email", "WhatsApp"] as const),
        recipient: c.phone,
        customerId: c.id,
        template: "expiry-reminder",
        subject: channelSubject(c.name),
        body: tpl
          .replace("{name}", c.name)
          .replace("{amount}", String(c.monthlyBill))
          .replace("{date}", c.expiryDate.toDateString()),
        status: sent ? (chance(0.9) ? "Sent" : "Failed") : "Scheduled",
        error: sent ? null : "Invalid number",
        sentById: userIds.adminId,
        sentAt: sent ? addDays(new Date(), -between(0, 20)) : null,
        scheduledAt: sent ? null : addDays(new Date(), between(1, 5)),
      },
    });
  }
}

function channelSubject(name: string) {
  return `Billing update for ${name}`;
}

async function seedHr(ref: Ref) {
  const now = new Date();
  for (const emp of ref.employees) {
    for (let m = 0; m < 2; m++) {
      const month = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const basic = emp.role.includes("Engineer") ? 45000 : emp.role.includes("Accountant") ? 38000 : 22000;
      const net = round2(basic + 5000 - (chance(0.2) ? between(500, 2000) : 0));
      await prisma.salary.create({
        data: {
          employeeId: emp.id,
          month: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
          basic,
          allowance: 5000,
          bonus: chance(0.3) ? between(1000, 3000) : 0,
          deduction: chance(0.2) ? between(500, 2000) : 0,
          advance: 0,
          netSalary: net,
          status: m === 0 ? "Paid" : "Pending",
          paidAt: m === 0 ? month : null,
        },
      });
    }

    for (let d = 20; d >= 0; d--) {
      const date = addDays(now, -d);
      if (date.getDay() === 5) continue; // friday off
      const roll = rnd();
      const status = roll > 0.93 ? "Absent" : roll > 0.86 ? "Late" : roll > 0.82 ? "Leave" : "Present";
      const checkIn = new Date(date);
      checkIn.setHours(9, status === "Late" ? between(5, 50) : between(0, 20), 0, 0);
      const checkOut = new Date(date);
      checkOut.setHours(18, between(0, 55), 0, 0);
      await prisma.attendance.create({
        data: {
          employeeId: emp.id,
          date: startOfDay(date),
          checkIn: status === "Absent" ? null : checkIn,
          checkOut: status === "Absent" ? null : checkOut,
          status,
        },
      });
    }

    if (chance(0.4)) {
      await prisma.leave.create({
        data: {
          employeeId: emp.id,
          leaveType: pick(["Casual", "Sick", "Annual", "Unpaid"] as const),
          startDate: addDays(now, between(-20, 10)),
          endDate: addDays(now, between(11, 18)),
          reason: "Family event",
          status: pick(["Pending", "Approved", "Approved"] as const),
          approvedBy: "System Administrator",
        },
      });
    }
  }
}

async function seedActivity(userIds: { adminId: string; managerId: string }, customers: Awaited<ReturnType<typeof seedBilling>>["customers"]) {
  const sample = customers.slice(0, 25);
  for (const c of sample) {
    await prisma.activityLog.create({
      data: {
        action: pick(["Create", "Update", "Renew", "Suspend", "Reconnect", "Change Package"] as const),
        entity: "Customer",
        entityId: c.id,
        summary: `${c.name} (${c.username}) record updated`,
        actorId: chance(0.5) ? userIds.adminId : userIds.managerId,
        createdAt: addDays(new Date(), -between(0, 30)),
      },
    });
  }
}

/**
 * The runtime number generator keeps its own `Counter` rows. The seed inserts
 * documents directly, so the counters must be moved past the highest value
 * already used, otherwise the first real invoice/payment would collide.
 */
/**
 * Stock, and a few devices already out with customers.
 *
 * Seeded through the same shape the app uses — a receipt, then issues — rather
 * than by writing a balance directly, so the demo data's balances are provably
 * the sum of their movements. Seed data that violates the module's own central
 * rule is worse than none: it teaches the wrong thing to whoever is evaluating
 * the system.
 */
async function seedInventory(
  ref: Ref,
  customers: Awaited<ReturnType<typeof seedBilling>>["customers"],
  userIds: { adminId: string; techId: string }
) {
  // This section clears its own tables first. The rest of the seed assumes a
  // fresh database, but a section that can fail half way through — a missing
  // customer, a bad row — would otherwise poison every retry with a unique
  // violation on the second run, and the original error would be invisible.
  await prisma.customerEquipment.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.inventoryItem.deleteMany();

  const catalogue = [
    { name: "GPON ONT 1G, ZTE", sku: "ONT-ZTE-1G", category: "ONU", unit: "pcs", qty: 34, reorder: 10, price: 2200 },
    { name: "GPON ONT 300M, VSOL", sku: "ONT-VSOL-300", category: "ONU", unit: "pcs", qty: 6, reorder: 10, price: 1450 },
    { name: "FTTH drop cable 2km", sku: "CAB-FTTH-2K", category: "Cable", unit: "m", qty: 4200, reorder: 500, price: 12 },
    { name: "1:8 PLC splitter", sku: "SPL-1x8", category: "Splitter", unit: "pcs", qty: 48, reorder: 15, price: 320 },
    { name: "SC/APC pigtail", sku: "CON-APC", category: "Connector", unit: "pcs", qty: 260, reorder: 50, price: 45 },
    { name: "WiFi 6 CPE, TP-Link", sku: "RTR-TPL-XDR", category: "Router", unit: "pcs", qty: 3, reorder: 5, price: 3400 },
  ];

  const items = [];
  for (const c of catalogue) {
    const item = await prisma.inventoryItem.create({
      data: {
        name: c.name,
        sku: c.sku,
        category: c.category,
        unit: c.unit,
        reorderLevel: c.reorder,
        unitPrice: c.price,
        quantity: 0,
      },
    });
    // The opening receipt. Everything after this is a movement like any other.
    await prisma.stockMovement.create({
      data: {
        itemId: item.id,
        type: "IN",
        quantity: c.qty,
        note: "Opening stock",
        reference: "OPENING",
        createdById: userIds.adminId,
      },
    });
    items.push({ ...item, opening: c.qty, category: c.category });
  }

  const onu = items[0];
  const cable = items[2];

  // A handful of ONUs out with real customers, so the equipment trail is visible
  // rather than theoretical.
  for (let i = 0; i < 8; i++) {
    const customer = customers[i];
    if (!customer) continue;
    const serial = `ZTE1G-${String(100000 + i * 137)}`;
    const issued = await prisma.customerEquipment.create({
      data: {
        customerId: customer.id,
        itemId: onu.id,
        serial,
        status: "Assigned",
      },
    });
    await prisma.stockMovement.create({
      data: {
        itemId: onu.id,
        type: "OUT",
        quantity: -1,
        note: "Installed at activation",
        reference: issued.serial,
        createdById: userIds.techId,
      },
    });
  }

  // One returned and one written off, so the history shows both outcomes rather
  // than only the tidy case.
  const spare = await prisma.customerEquipment.create({
    data: { customerId: customers[8]?.id ?? customers[0].id, itemId: onu.id, serial: "ZTE1G-999001", status: "Assigned" },
  });
  await prisma.stockMovement.create({
    data: { itemId: onu.id, type: "IN", quantity: 1, note: "Returned - customer moved, kept the ONU", reference: spare.serial },
  });
  await prisma.customerEquipment.update({ where: { id: spare.id }, data: { status: "Returned", returnedAt: new Date() } });

  const faulty = await prisma.customerEquipment.create({
    data: { customerId: customers[9]?.id ?? customers[0].id, itemId: onu.id, serial: "ZTE1G-999002", status: "Faulty", returnedAt: new Date() },
  });
  await prisma.stockMovement.create({
    data: { itemId: onu.id, type: "OUT", quantity: 0, note: "Written off as faulty - no light after a power cut", reference: faulty.serial },
  });

  // Cable consumed on a job.
  await prisma.stockMovement.create({
    data: { itemId: cable.id, type: "OUT", quantity: -320, note: "Fibre drop to Mirpur 12", reference: "WO-441", createdById: userIds.techId },
  });

  // The balances are derived from the movements rather than typed, so the demo
  // data cannot disagree with its own ledger.
  const sums = await prisma.stockMovement.groupBy({ by: ["itemId"], _sum: { quantity: true } });
  for (const row of sums) {
    await prisma.inventoryItem.update({
      where: { id: row.itemId },
      data: { quantity: row._sum.quantity ?? 0 },
    });
  }
  void ref;
}

async function alignCounters() {
  /**
   * `where` is a full condition, not a fragment: the previous version pasted it
   * straight after the table name with no `WHERE`, which is a syntax error. It
   * only ever ran on the refund line, so the seed failed on that line and the
   * refund counter was never aligned — `npm run setup` has been broken since
   * refunds were added.
   */
  const seq = async (key: string, table: string, column: string, where?: string) => {
    const clause = where ? ` WHERE ${where}` : "";
    // Take the digits at the end of the document number, e.g. "PAY-000123".
    const row = (await prisma.$queryRawUnsafe<{ v: bigint | number | null }[]>(
      `SELECT MAX(NULLIF(SUBSTRING("${column}" FROM '[0-9]+$'), '')::bigint) AS v FROM "${table}"${clause}`
    ))[0];
    const value = Number(row?.v ?? 0);

    // If the column exists but nothing parsed, the pattern is wrong and the
    // counter would sit at 0 — the first real document would then collide.
    if (value === 0) {
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM "${table}"${clause}`
      );
      if (count > 0) {
        throw new Error(
          `Counter "${key}" could not be read from ${table}."${column}" — ` +
            `the table has ${count} rows but no number matched.`
        );
      }
    }

    await prisma.counter.upsert({
      where: { id: key },
      create: { id: key, value },
      update: { value },
    });
  };

  await seq("customer", "Customer", "customerCode");
  await seq("invoice", "Invoice", "invoiceNumber");
  await seq("payment", "Payment", "paymentId");
  await seq("receipt", "Receipt", "receiptNumber");
  await seq("ticket", "Ticket", "ticketNumber");
  await seq("transfer", "AccountTransfer", "reference");
  await seq("shift", "CashShift", "shiftNumber");
  // Refunds reuse the transaction reference column, so the counter has to be read
  // from refund rows only — otherwise the highest transfer reference would
  // become the next refund number.
  await seq("refund", "AccountTransaction", "reference", `"reference" LIKE 'RFD-%'`);
}

/**
 * Recomputes the denormalised due/status columns using the same rules the
 * billing service applies, so seeded data matches what the app would produce.
 */
async function recomputeBalances() {
  const { recomputeCustomerBilling, recomputeInvoiceStatus } = await import(
    "../src/lib/services/billing"
  );
  const customers = await prisma.customer.findMany({ select: { id: true } });

  // small chunks keep each SQLite transaction quick
  const CHUNK = 50;
  for (let i = 0; i < customers.length; i += CHUNK) {
    const slice = customers.slice(i, i + CHUNK);
    for (const c of slice) {
      await prisma.$transaction(async (tx) => {
        await recomputeCustomerBilling(tx, c.id);
      });
    }
  }

  const invoices = await prisma.invoice.findMany({
    where: { status: { not: "Cancelled" } },
    select: { id: true },
  });
  for (const inv of invoices) {
    await prisma.$transaction(async (tx) => {
      await recomputeInvoiceStatus(tx, inv.id);
    });
  }
}

async function main() {
  console.log("Resetting database...");
  await reset();

  console.log("Seeding roles and users...");
  const userIds = await seedRolesAndUsers();

  console.log("Seeding settings...");
  await seedSettings();

  console.log("Seeding reference data...");
  const ref = await seedReference();

  console.log("Seeding customers, invoices and payments (this takes a moment)...");
  const { customers } = await seedBilling(ref, userIds);

  console.log("Seeding support tickets...");
  await seedTickets(ref, customers, userIds);

  console.log("Seeding expenses...");
  await seedExpenses(ref, userIds);

  console.log("Seeding notifications...");
  await seedNotifications(ref, customers, userIds);

  console.log("Seeding HR records...");
  await seedHr(ref);

  console.log("Seeding resellers...");

  // Two zone resellers, and one inactive, so the list and the report have
  // something to show. Payments attributed to them are created below so the
  // commission figure is derived from real rows rather than asserted at.
  const karim = await prisma.reseller.create({
    data: {
      name: "Karim Uddin",
      phone: "01711000111",
      areaId: ref.areas[0]?.id ?? null,
      commissionPct: 7.5,
      status: "Active",
    },
    select: { id: true, name: true, commissionPct: true },
  });

  const selina = await prisma.reseller.create({
    data: {
      name: "Selina Akter",
      phone: "01711000222",
      areaId: ref.areas[1]?.id ?? null,
      commissionPct: 6,
      status: "Active",
    },
    select: { id: true, name: true, commissionPct: true },
  });

  await prisma.reseller.create({
    data: { name: "Rafiq (retired)", phone: null, commissionPct: 5, status: "Inactive" },
  });

  // A few customers attributed to the zone resellers, and a handful of payments
  // taken by them — so the commission report reconciles with payment rows
  // instead of being a number nothing produces.
  const maxRow = await prisma.payment.aggregate({ _max: { paymentId: true } });
  const existingMaxId = maxRow._max.paymentId ?? "PAY-000000";
  let paymentSeq = 0;

  for (const [i, reseller] of [karim, selina].entries()) {
    for (let c = 0; c < 4; c++) {
      const customer = customers[i * 4 + c];
      if (!customer) continue;
      await prisma.customer.update({ where: { id: customer.id }, data: { resellerId: reseller.id } });

      for (let p = 0; p < 2; p++) {
        const existing = await prisma.payment.findFirst({
          where: { customerId: customer.id, note: "Zone collection" },
        });
        if (existing) continue;

        // Started above whatever already exists rather than from zero, because
        // this section runs after seedBilling and a payment id is unique. The
        // counter is reconciled at the end by alignCounters().
        const [, tail] = /^PAY-(\d+)$/.exec(existingMaxId) ?? [];
        paymentSeq = Math.max(paymentSeq, Number(tail ?? 0)) + 1;
        const paymentId = `PAY-${String(paymentSeq).padStart(6, "0")}`;
        await prisma.payment.create({
          data: {
            paymentId,
            customerId: customer.id,
            amount: between(400, 1500),
            method: "Cash",
            accountId: (await prisma.account.findFirstOrThrow({ where: { type: "Cash" } })).id,
            collectedByResellerId: reseller.id,
            paymentDate: addDays(new Date(), -between(1, 25)),
            note: "Zone collection",
          },
        });
      }
    }
  }

  // A portal password for the first two customers, so the portal can be tried
  // without staff setting anything up. Deliberately not the PPPoE password: the
  // portal credential is a separate bcrypt hash, which is the whole point.
  for (const [i, customer] of customers.slice(0, 2).entries()) {
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        portalPasswordHash: await bcrypt.hash("portal" + (i + 1), 10),
        portalTokenVersion: 1,
      },
    });
  }
  console.log(
    `  demo portal accounts: ${customers[0]?.username} / portal1, ${customers[1]?.username} / portal2`
  );

  // A support history for the demo customer, so the portal's ticket list and
  // the staff queue both have something real in them on first load.
  //
  // The mix matters more than the volume. A list of only open tickets reads as a
  // backlog; one of only closed tickets reads as an empty system. One of each,
  // with a real reply on the open one, is what an operator actually sees.
  // By username, never by array position: the printed credentials and the
  // showcase data have to be the same customer, and the position moves whenever
  // the seed changes.
  const showcase = await prisma.customer.findFirstOrThrow({
    where: { username: "nabila1" },
    select: { id: true, name: true, packageId: true },
  });
  const demoCustomer = showcase;
  {
    const highest = (await prisma.ticket.aggregate({ _max: { ticketNumber: true } }))._max
      ?.ticketNumber;
    let n = Number(/TKT-(\d+)$/.exec(highest ?? "TKT-0")?.[1] ?? 0);

    // An invoice left unpaid, so the portal's overview has something to show.
    // A customer with a zero balance is technically correct and makes a poor
    // demonstration: the screen an interested visitor looks at first would say
    // "Nothing outstanding", which reads as an empty system rather than a
    // working one. recomputeBalances() at the end of the seed derives
    // previousDue from this, so the figure is never stored by hand.
    const unpaid = await prisma.invoice.findFirst({
      where: { customerId: demoCustomer.id, status: { in: ["Due", "Partial"] } },
      select: { id: true },
    });
    if (!unpaid) {
      const pkg = await prisma.package.findFirstOrThrow({ orderBy: { monthlyPrice: "asc" } });
      const issue = addDays(new Date(), -12);
      const due = addDays(new Date(), 2);
      await prisma.invoice.create({
        data: {
          invoiceNumber: `DEMO-${new Date().getFullYear()}-UNPAID`,
          customerId: demoCustomer.id,
          packageId: pkg.id,
          issueDate: issue,
          dueDate: due,
          billingFrom: issue,
          billingTo: due,
          amount: pkg.monthlyPrice,
          total: pkg.monthlyPrice,
          paid: 0,
          status: "Due",
          note: "Deliberately left unpaid so the portal overview has a balance to show.",
        },
      });
    }

    // Keyed on the demo tickets themselves rather than "this customer has no
    // tickets", because the seed already gives customers tickets and that check
    // would silently skip the showcase data on every run after the first.
    const alreadyDemo = await prisma.ticket.count({
      where: { customerId: demoCustomer.id, category: { in: ["Frequent Disconnection", "Line Problem"] } },
    });
    if (alreadyDemo === 0) {
      const openTicket = await prisma.ticket.create({
        data: {
          ticketNumber: `TKT-${String(++n).padStart(6, "0")}`,
          customerId: demoCustomer.id,
          subject: "Frequent disconnection every evening around 8pm",
          problem: "Frequent Disconnection",
          category: "Frequent Disconnection",
          description:
            "For the past four evenings my line drops roughly every twenty minutes between 8pm and 9pm. During the day it is stable, and speeds are fine when it is up.",
          priority: "High",
          status: "In Progress",
        },
        select: { id: true },
      });
      await prisma.ticketComment.create({
        data: {
          ticketId: openTicket.id,
          authorName: "Md Jahangir Alam",
          body: "Thank you for the detail. That timing points at peak-hour load, so I am checking the OLT port and the upstream link now.",
        },
      });
      await prisma.ticketComment.create({
        data: {
          ticketId: openTicket.id,
          authorName: demoCustomer.name,
          body: "Thank you. It is worst on Sundays, if that helps.",
        },
      });

      const closedTicket = await prisma.ticket.create({
        data: {
          ticketNumber: `TKT-${String(++n).padStart(6, "0")}`,
          customerId: demoCustomer.id,
          subject: "ONU light blinking red after a power cut",
          problem: "Line Problem",
          category: "Line Problem",
          description: "The red light on my ONU has been on since the power came back.",
          priority: "Normal",
          status: "Resolved",
          resolvedAt: addDays(new Date(), -6),
        },
        select: { id: true },
      });
      await prisma.ticketComment.create({
        data: {
          ticketId: closedTicket.id,
          authorName: "Md Jahangir Alam",
          body: "The ONU had lost its registration. I reregistered it remotely and it is back online.",
        },
      });
    }
  }

  console.log("Seeding inventory...");
  await seedInventory(ref, customers, userIds);

  console.log("Seeding activity log...");
  await seedActivity(userIds, customers);

  console.log("Aligning document counters and recomputing balances...");
  await alignCounters();
  await recomputeBalances();

  const counts = {
    users: await prisma.user.count(),
    areas: await prisma.area.count(),
    packages: await prisma.package.count(),
    customers: await prisma.customer.count(),
    invoices: await prisma.invoice.count(),
    payments: await prisma.payment.count(),
    receipts: await prisma.receipt.count(),
    expenses: await prisma.expense.count(),
    tickets: await prisma.ticket.count(),
    onus: await prisma.onu.count(),
    inventoryItems: await prisma.inventoryItem.count(),
    stockMovements: await prisma.stockMovement.count(),
    equipmentOut: await prisma.customerEquipment.count(),
  };
  console.log("\nSeed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
