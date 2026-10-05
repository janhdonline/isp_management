import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { StatCard, StatCardGrid } from "@/components/ui/stat-card";
import { ShieldCheck, Users } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Security settings" };

const FIELDS = [
  {
    key: "security.require2fa",
    label: "Roles that must use two-factor authentication",
    hint: 'Comma-separated role names, e.g. "Administrator,Account Manager". Anyone in a listed role cannot sign in with a password alone — they are sent to set up an authenticator first. Empty means optional for everyone. Turning this on locks out existing members of those roles at their next sign-in.',
  },
];

/**
 * Security policy.
 *
 * Its own settings page rather than a tab on Users, because "which roles must carry
 * a second factor" is a policy about the whole staff rather than a setting about
 * one of them, and it is exactly the sort of thing that gets left off when it lives
 * somewhere nobody thinks to look.
 */
export default async function SecuritySettingsPage() {
  const settings = await getSettings();
  const roles = await prisma.role.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const enrolled = await prisma.user.count({ where: { totpEnabled: true } });
  const total = await prisma.user.count({ where: { status: "Active" } });

  return (
    <>
      <PageHeader
        title="Security settings"
        description="Who has to prove it twice, and who can switch them off."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Security" }]}
      />
      <PageContainer className="max-w-4xl space-y-4">
        <StatCardGrid>
          <StatCard
            label="Staff with 2FA"
            value={`${enrolled}/${total}`}
            icon={ShieldCheck}
            tone={enrolled > 0 ? "success" : "neutral"}
            hint="active accounts"
          />
          <StatCard label="Roles" value={roles.length} icon={Users} tone="info" />
        </StatCardGrid>

        <SettingsForm
          fields={FIELDS}
          values={settings}
          title="Two-factor policy"
          description="Applies at the next sign-in, not retroactively to anyone already signed in."
        />

        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <p className="text-sm font-medium">Turning a role on does not turn 2FA on</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            It requires it. Nobody&apos;s existing second factor is removed by this setting, and
            nobody who has already enabled one can be switched back to password-only by
            changing it — a role change must not quietly downgrade somebody&apos;s security.
            An administrator has to reset a user&apos;s 2FA deliberately, from Users &amp; Roles.
          </p>
        </div>
      </PageContainer>
    </>
  );
}
