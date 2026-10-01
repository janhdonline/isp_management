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
  {
    key: "network.mikrotikSessionSource",
    label: "Subscribers are terminated on",
    type: "select",
    options: ["ppp", "hotspot"],
    hint: "PPPoE for fibre broadband; Hotspot only if you run a Hotspot server",
  },
  { key: "network.radiusServer", label: "RADIUS Server" },
  { key: "network.radiusPort", label: "RADIUS Port", type: "number" },
  { key: "network.radiusSecret", label: "RADIUS Shared Secret", type: "password" },
  {
    key: "radius.simultaneousUse",
    label: "Concurrent sessions per subscriber",
    type: "number",
    // The wording is the decision: 1 refuses a second device, and on a PPPoE
    // account that is nearly always credential sharing — one account, two
    // households — where the FUP allowance is being spent by two people and
    // billed to one. 0 turns the control off entirely, which is a legitimate
    // choice for flat-rate products.
    hint:
      "How many RADIUS sessions one username may have open at once. 1 refuses a second " +
      "device while the first is still connected. 0 means unlimited — use that for flat-rate " +
      "products where sharing is not a concern, or a legitimate second device will be refused.",
  },
  { key: "radius.logRetentionDays", label: "RADIUS log retention (days)", type: "number" },
  { key: "network.oltVendor", label: "OLT Vendor", type: "select", options: ["Huawei", "ZTE", "Nokia", "Fiberhome", "Other"] },
  { key: "network.oltHost", label: "OLT Host" },
  { key: "network.oltPort", label: "OLT API Port", type: "number" },
  { key: "network.oltUsername", label: "OLT Username" },
  { key: "network.oltPassword", label: "OLT Password", type: "password" },
  { key: "network.defaultIpPool", label: "Default IP Pool" },
  { key: "network.defaultRouter", label: "Default Router" },
  { key: "network.defaultPackage", label: "Default Package" },
  {
    key: "network.fupAction",
    label: "Data limit (FUP) action",
    type: "select",
    // The wording is the decision, not the label: "throttle" slows a paying
    // customer down, and whoever sets it should be choosing that knowingly.
    options: ["off", "notify", "throttle"],
    hint:
      "What happens when a subscriber uses up their package's data allowance. " +
      "Off does nothing. Notify only tells the customer. Throttle also moves them to the " +
      "package's throttled profile, and needs that profile to be set on the package.",
  },
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
