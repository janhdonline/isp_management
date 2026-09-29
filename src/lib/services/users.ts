import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { prismaLog } from "@/lib/services/activity";

/* ------------------------------------------------------------------ */
/* Listing                                                             */
/* ------------------------------------------------------------------ */

export async function listUsers() {
  return prisma.user.findMany({
    include: { role: { select: { id: true, name: true } } },
    orderBy: { name: "asc" },
  });
}

export async function listRoles() {
  return prisma.role.findMany({
    include: {
      _count: { select: { users: true, permissions: true } },
      permissions: { select: { permission: { select: { key: true, label: true } } } },
    },
    orderBy: { name: "asc" },
  });
}

/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */

export async function createUser(input: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  roleId: string;
  status?: string;
  actorId: string;
}) {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error("A user with that email already exists");

  const role = await prisma.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new Error("Choose a role");

  const user = await prisma.user.create({
    data: {
      name: input.name.trim(),
      email,
      phone: input.phone || null,
      passwordHash: await hashPassword(input.password),
      roleId: input.roleId,
      status: input.status || "Active",
    },
    include: { role: { select: { name: true } } },
  });

  await prismaLog(prisma, {
    action: "Create",
    entity: "User",
    entityId: user.id,
    summary: `Created user ${user.name} (${user.email}) with role ${role.name}`,
  }, input.actorId);

  return user;
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

export async function updateUser(
  id: string,
  input: {
    name?: string;
    email?: string;
    phone?: string | null;
    roleId?: string;
    status?: string;
    actorId: string;
  }
) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { role: { select: { name: true } } },
  });

  // Moving yourself out of the Administrator role can lock everyone out of
  // user management, so it is refused rather than allowed to surprise the
  // person who did it.
  if (user.email === process.env.SELF_ADMIN_EMAIL && input.roleId) {
    const newRole = await prisma.role.findUnique({ where: { id: input.roleId } });
    if (newRole?.name !== "Administrator") {
      throw new Error("You cannot remove your own Administrator role");
    }
  }

  if (input.email && input.email.trim().toLowerCase() !== user.email) {
    const taken = await prisma.user.findUnique({ where: { email: input.email.trim().toLowerCase() } });
    if (taken) throw new Error("Another user already uses that email");
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      name: input.name?.trim() || undefined,
      email: input.email?.trim().toLowerCase() || undefined,
      phone: input.phone === undefined ? undefined : input.phone || null,
      roleId: input.roleId,
      status: input.status,
    },
    include: { role: { select: { name: true } } },
  });

  const changes = [
    input.name && input.name !== user.name ? "name" : null,
    input.email && input.email !== user.email ? "email" : null,
    input.roleId && input.roleId !== user.roleId ? "role" : null,
    input.status && input.status !== user.status ? "status" : null,
  ].filter(Boolean);

  await prismaLog(prisma, {
    action: "Update",
    entity: "User",
    entityId: id,
    summary: `Updated ${updated.name}: ${changes.join(", ") || "no change"}`,
  }, input.actorId);

  return updated;
}

/* ------------------------------------------------------------------ */
/* Password                                                            */
/* ------------------------------------------------------------------ */

/**
 * Changes a password and ends every session that user holds, including the one
 * that asked for the change. A password change that leaves old sessions alive
 * is not a password change, it is a suggestion.
 */
export async function changePassword(input: {
  userId: string;
  currentPassword?: string; // required when changing your own
  newPassword: string;
  actorId: string;
  self: boolean;
}) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.userId } });

  if (input.self) {
    if (!input.currentPassword) throw new Error("Enter your current password");
    const { compare } = await import("bcryptjs");
    if (!(await compare(input.currentPassword, user.passwordHash))) {
      throw new Error("Your current password is not correct");
    }
  }

  await prisma.user.update({
    where: { id: input.userId },
    data: { passwordHash: await hashPassword(input.newPassword) },
  });

  // Sessions are stateless JWTs, so "revoking" them is done by bumping a
  // per-user token version that the cookie also carries. A cookie signed
  // before the bump no longer verifies.
  await prisma.user.update({
    where: { id: input.userId },
    data: { tokenVersion: { increment: 1 } },
  });

  await prismaLog(prisma, {
    action: "Password",
    entity: "User",
    entityId: input.userId,
    summary: `${input.self ? "Changed own password" : `Reset password for ${user.name}`} and ended active sessions`,
  }, input.actorId);

  return true;
}

/** Ends every session a user holds without touching their password. */
export async function revokeSessions(userId: string, actorId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
  await prismaLog(prisma, {
    action: "Revoke",
    entity: "User",
    entityId: userId,
    summary: `Ended all active sessions for ${user.name}`,
  }, actorId);
  return true;
}

/* ------------------------------------------------------------------ */
/* Delete                                                              */
/* ------------------------------------------------------------------ */

export async function deleteUser(id: string, actorId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id },
    include: { role: { select: { name: true } } },
  });

  // The last administrator cannot be removed, or the system becomes
  // impossible to administer.
  if (user.role?.name === "Administrator") {
    const admins = await prisma.user.count({
      where: { role: { name: "Administrator" }, status: "Active", id: { not: id } },
    });
    if (admins === 0) throw new Error("This is the last active Administrator and cannot be deleted");
  }

  // Anyone who has created a record keeps those records; the user is made
  // inactive instead, so the history stays attributable.
  const [payments, invoices, tickets] = await Promise.all([
    prisma.payment.count({ where: { collectedById: id } }),
    prisma.invoice.count({ where: { createdById: id } }),
    prisma.ticket.count({ where: { createdById: id } }),
  ]);
  if (payments + invoices + tickets > 0) {
    throw new Error(
      `${user.name} has created records (${payments} payments, ${invoices} invoices, ${tickets} tickets). Set them to Inactive instead so the history stays intact.`
    );
  }

  await prisma.user.delete({ where: { id } });
  await prismaLog(prisma, {
    action: "Delete",
    entity: "User",
    entityId: id,
    summary: `Deleted user ${user.name} (${user.email})`,
  }, actorId);
  return true;
}
