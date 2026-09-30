/**
 * Brings the Permission table and the role grants in line with the current
 * `PERMISSION_RESOURCES` / `PERMISSION_ACTIONS` lists.
 *
 * Adding a resource to those arrays is not enough on its own: the database has
 * rows of its own, and every existing role was granted permissions from the list
 * as it was when that role was created. Without this, a newly added module
 * exists in the code and is invisible to everyone — the nav is gated on a
 * permission nobody holds, which reads exactly like a broken sidebar.
 *
 * Idempotent: safe to run as often as you like, which is what makes it fit in
 * setup rather than needing a hand-written fix each time.
 */
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { PrismaPg } from "@prisma/adapter-pg";
import { databaseUrl } from "../src/lib/db-url.ts";
import { buildPermissionKeys, ROLE_GRANT_RULES } from "../src/lib/permissions.ts";

const adapter = new PrismaPg({ connectionString: databaseUrl() });
const prisma = new PrismaClient({ adapter });

const keys = buildPermissionKeys();

// 1. Every permission key that exists in code exists in the table.
let added = 0;
for (const p of keys) {
  const existing = await prisma.permission.findUnique({ where: { key: p.key } });
  if (existing) continue;
  await prisma.permission.create({ data: p });
  added += 1;
}

// 2. Every system role holds what the rules say it should.
const roles = await prisma.role.findMany({
  where: { isSystem: true },
  include: { permissions: { include: { permission: true } } },
});

let granted = 0;
for (const role of roles) {
  const wanted = keys.filter((p) => ROLE_GRANT_RULES[role.name]?.(p)).map((p) => p.key);
  if (!wanted.length) continue;

  const held = new Set(role.permissions.map((rp) => rp.permission.key));
  const wantedSet = new Set(wanted);
  for (const perm of await prisma.permission.findMany({ where: { key: { in: wanted } } })) {
    if (held.has(perm.key)) continue;
    await prisma.rolePermission.create({
      data: { roleId: role.id, permissionId: perm.id },
    });
    granted += 1;
  }
  void wantedSet;
}

console.log(`permissions: ${keys.length} defined, ${added} new, ${granted} new role grants`);
await prisma.$disconnect();
