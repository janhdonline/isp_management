import bcrypt from "bcryptjs";

/**
 * Password hashing.
 *
 * bcrypt with cost 12: roughly a quarter of a second on a current server,
 * which is slow enough to make offline guessing expensive and fast enough that
 * a sign-in still feels instant. The cost is stored inside the hash, so raising
 * it later does not invalidate existing passwords.
 */

const COST = 12;

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

/**
 * The rule every user password has to satisfy. Length does more here than
 * character classes do: a long passphrase beats a short string with a symbol
 * in it, and staff in the field rarely manage to remember symbol rules.
 */
export function checkPasswordStrength(plain: string): string | null {
  if (plain.length < 8) return "Use at least 8 characters";
  if (plain.length > 200) return "That is longer than any password needs to be";
  if (/^(.)\1+$/.test(plain)) return "Do not use a single repeated character";
  const common = ["password", "12345678", "qwerty", "letmein", "admin123"];
  if (common.some((c) => plain.toLowerCase().includes(c))) {
    return "That contains a very common password";
  }
  return null;
}
