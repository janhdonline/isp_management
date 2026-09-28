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

export function hasPermission(
  permissions: string[] | undefined,
  key: string,
  isAdmin?: boolean
): boolean {
  if (isAdmin) return true;
  return permissions?.includes(key) ?? false;
}
