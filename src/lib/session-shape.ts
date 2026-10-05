/**
 * The shape of a signed-in user, as it appears in a session cookie.
 *
 * Its own file because it is a type, and `auth.ts` cannot be imported from a
 * plain test: it opens with `import "server-only"`, which throws outside a
 * `react-server` bundle. See `src/lib/secret-key.ts` for the full explanation.
 */
export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  roleId: string | null;
  permissions: string[];
  isAdmin: boolean;
  /**
   * Copied from the user row at sign-in. `getSession` compares it with the current
   * value, so a password change or a revoke ends every cookie issued before it,
   * without keeping a server-side session list.
   */
  tokenVersion: number;
};
