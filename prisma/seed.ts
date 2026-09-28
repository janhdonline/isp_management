/**
 * Development seed: creates roles, users, reference data and a realistic
 * 90-day history of customers, invoices, payments and sessions so every page
 * in the app has real rows to render.
 *
 * Run with:  npx prisma db seed
 */
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { buildPermissionKeys } from "../src/lib/permissions";

const adapter = new PrismaPg({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://postgres:postgres@127.0.0.1:5432/isp?schema=public",
});
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

  const adminRole = await prisma.role.create({
    data: {
      name: "Administrator",
      description: "Full access to every module",
      isSystem: true,
      permissions: {
        create: permissions.map((p) => ({ permission: { connect: { key: p.key } } })),
      },
    },
  });

  const managerRole = await prisma.role.create({
    data: {
      name: "Account Manager",
      description: "Customers, billing and accounts",
      isSystem: true,
      permissions: {
        create: permissions
          .filter((p) => p.resource !== "Settings")
          .filter((p) => !["employees.delete", "support.delete"].includes(p.key))
          .map((p) => ({ permission: { connect: { key: p.key } } })),
      },
    },
  });

  const techRole = await prisma.role.create({
    data: {
      name: "Technician",
      description: "Network monitoring and support tickets",
      isSystem: true,
      permissions: {
        create: permissions
          .filter((p) => ["Network", "Support", "Customers"].includes(p.resource))
          .filter((p) => p.action === "View" || p.action === "Edit" || p.action === "Create")
          .map((p) => ({ permission: { connect: { key: p.key } } })),
      },
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
async function alignCounters() {
  const seq = async (key: string, table: string, column: string) => {
    // Take the digits at the end of the document number, e.g. "PAY-000123".
    const row = (await prisma.$queryRawUnsafe<{ v: bigint | number | null }[]>(
      `SELECT MAX(NULLIF(SUBSTRING("${column}" FROM '[0-9]+$'), '')::bigint) AS v FROM "${table}"`
    ))[0];
    const value = Number(row?.v ?? 0);

    // If the column exists but nothing parsed, the pattern is wrong and the
    // counter would sit at 0 — the first real document would then collide.
    if (value === 0) {
      const [{ count }] = await prisma.$queryRawUnsafe<{ count: number }[]>(
        `SELECT COUNT(*)::int AS count FROM "${table}"`
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
  };
  console.log("\nSeed complete:", counts);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
