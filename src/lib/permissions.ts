import { PERMISSION_ACTIONS, PERMISSION_RESOURCES } from "@/lib/enums";

/**
 * Permission keys are `${resource.toLowerCase()}.${action.toLowerCase()}`,
 * e.g. "customers.create". Built from the ISP.md section 14 "Users & Roles"
 * matrix so a new resource only needs to be added to the arrays above.
 */
export type PermissionKey =
  | `${Lowercase<(typeof PERMISSION_RESOURCES)[number]>}.${Lowercase<
      (typeof PERMISSION_ACTIONS)[number]
    >}`;

export function buildPermissionKeys(): { key: string; resource: string; action: string; label: string }[] {
  const out: { key: string; resource: string; action: string; label: string }[] = [];
  for (const resource of PERMISSION_RESOURCES) {
    for (const action of PERMISSION_ACTIONS) {
      out.push({
        key: `${resource.toLowerCase()}.${action.toLowerCase()}`,
        resource,
        action,
        label: `${action} ${resource}`,
      });
    }
  }
  return out;
}

export const ALL_PERMISSION_KEYS: string[] = buildPermissionKeys().map((p) => p.key);

/**
 * What each system role is granted, as a rule rather than a stored list.
 *
 * Kept here — and read by both the seed and `scripts/sync-permissions.mjs` —
 * because those two have to agree. When they were separate copies, adding a
 * module granted it to fresh installs and to nobody who already had the system,
 * which is the worst version of the bug: it looks like the sidebar is broken.
 *
 * A role not named here is granted nothing, rather than everything. An
 * unrecognised role is far more likely to be a new one that still needs deciding
 * than a typo, and silently granting full access is not the safer default.
 */
export const ROLE_GRANT_RULES: Record<
  string,
  (permission: { key: string; resource: string; action: string }) => boolean
> = {
  Administrator: () => true,

  "Account Manager": (p) =>
    // Everything except the system configuration, and except the two deletions
    // that would lose records a manager has no business deleting.
    p.resource !== "Settings" && !["employees.delete", "support.delete"].includes(p.key),

  Technician: (p) =>
    ["Network", "Support", "Customers", "Inventory"].includes(p.resource) &&
    // Read, record and fix — but a technician does not delete a customer, close
    // a ticket as gone, or approve anything.
    ["View", "Edit", "Create"].includes(p.action),
};

export function hasPermission(
  permissions: string[] | undefined,
  key: string,
  isAdmin?: boolean
): boolean {
  if (isAdmin) return true;
  return permissions?.includes(key) ?? false;
}
