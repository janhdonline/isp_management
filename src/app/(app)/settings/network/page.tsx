import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { SettingsForm, TestButton, type SettingField } from "@/components/settings/settings-form";
import { testMikrotikAction } from "@/app/(app)/accounts/actions";
import { Card, CardBody } from "@/components/ui/card";
import { formatUptime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Network Settings" };

const FIELDS: SettingField[] = [
  { key: "network.mikrotikApiHost", label: "MikroTik API Host" },
  { key: "network.mikrotikApiPort", label: "MikroTik API Port", type: "number" },
  { key: "network.mikrotikUsername", label: "MikroTik API User" },
  { key: "network.mikrotikPassword", label: "MikroTik API Password", type: "password" },
  { key: "network.mikrotikSsl", label: "Use SSL for MikroTik API", type: "boolean" },
  { key: "network.radiusServer", label: "RADIUS Server" },
  { key: "network.radiusPort", label: "RADIUS Port", type: "number" },
  { key: "network.radiusSecret", label: "RADIUS Shared Secret", type: "password" },
  { key: "network.oltVendor", label: "OLT Vendor", type: "select", options: ["Huawei", "ZTE", "Nokia", "Fiberhome", "Other"] },
  { key: "network.oltHost", label: "OLT Host" },
  { key: "network.oltPort", label: "OLT API Port", type: "number" },
  { key: "network.oltUsername", label: "OLT Username" },
  { key: "network.oltPassword", label: "OLT Password", type: "password" },
  { key: "network.defaultIpPool", label: "Default IP Pool" },
  { key: "network.defaultRouter", label: "Default Router" },
  { key: "network.defaultPackage", label: "Default Package" },
];

export default async function NetworkSettingsPage() {
  const [settings, routers] = await Promise.all([
    getSettings(),
    prisma.router.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <>
      <PageHeader
        title="Network Settings"
        description="MikroTik, RADIUS and OLT credentials. Secrets are stored encrypted and never returned to the browser."
        breadcrumb={[{ label: "Settings", href: "/settings" }, { label: "Network" }]}
        actions={<TestButton action={testMikrotikAction} label="Test MikroTik" />}
      />
      <PageContainer className="max-w-4xl">
        <SettingsForm fields={FIELDS} values={settings} title="Device integrations" description="Each integration is consumed through a service adapter, never directly from the UI." />

        <Card className="mt-4">
          <CardBody>
            <h2 className="mb-3 text-sm font-semibold">Registered routers</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-fg-subtle">
                    <th className="py-2">Name</th>
                    <th className="py-2">IP</th>
                    <th className="py-2">API Port</th>
                    <th className="py-2">SSL</th>
                    <th className="py-2">Status</th>
                    <th className="py-2 text-right">Uptime</th>
                  </tr>
                </thead>
                <tbody>
                  {routers.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-2 font-medium">{r.name}</td>
                      <td className="py-2 font-mono text-xs">{r.ipAddress}</td>
                      <td className="tnum py-2 text-xs">{r.apiPort}</td>
                      <td className="py-2 text-xs">{r.useSsl ? "Yes" : "No"}</td>
                      <td className="py-2 text-xs">{r.status}</td>
                      <td className="tnum py-2 text-right text-xs">{formatUptime(r.uptimeSec)}</td>
                    </tr>
                  ))}
                  {routers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-xs text-fg-muted">
                        No routers registered.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
