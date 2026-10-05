import type { Metadata } from "next";
import { requireSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { requiresTotp } from "@/lib/services/totp";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { TotpPanel } from "./totp-panel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Account security" };

/**
 * A staff member's own security settings.
 *
 * There was no profile page to put this on, so this is the surface: the one place
 * a person can turn their own second factor on, see that it is on, and get it back
 * off again. It reads the *state* of 2FA and nothing else — the secret is not
 * loaded here and cannot be, which is the point.
 */
export default async function AccountSecurityPage() {
  const session = await requireSession();
  const [user, settings] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: session.id },
      select: { totpEnabled: true, totpEnabledAt: true, role: { select: { name: true } } },
    }),
    getSettings(),
  ]);

  const enforced = requiresTotp(user.role?.name, settings["security.require2fa"] ?? "");

  return (
    <>
      <PageHeader
        title="Account security"
        description="Your own sign-in protection."
        breadcrumb={[{ label: "Account", href: "/dashboard" }, { label: "Security" }]}
      />
      <PageContainer className="max-w-2xl space-y-4">
        <p className="text-sm text-fg-muted">
          Signed in as <strong>{session.name}</strong> ({session.email}) ·{" "}
          {user.role?.name ?? "Staff"}
        </p>

        <TotpPanel enabled={user.totpEnabled} enforced={enforced} />

        {user.totpEnabled && user.totpEnabledAt ? (
          <p className="text-xs text-fg-subtle">
            Turned on{" "}
            {user.totpEnabledAt.toISOString().replace("T", " ").slice(0, 16)} UTC.
          </p>
        ) : null}

        {enforced && !user.totpEnabled ? (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
            Your role is on the <code className="font-mono">security.require2fa</code> list, so
            you will be sent here at your next sign-in and will not reach the dashboard until
            two-factor authentication is on.
          </p>
        ) : null}
      </PageContainer>
    </>
  );
}
