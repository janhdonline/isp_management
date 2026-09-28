"use client";

import Link from "next/link";
import { DataTableShell, type Column } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { formatDate } from "@/lib/utils";

export type SubscriberRow = {
  id: string;
  name: string;
  username: string;
  expiryDate: Date | null;
  connectionStatus: string;
};

export function SubscriberTable({ rows }: { rows: SubscriberRow[] }) {
  const columns: Column<SubscriberRow>[] = [
    {
      key: "name",
      header: "Customer",
      cell: (c) => (
        <Link href={`/customers/${c.id}`} className="font-medium hover:text-brand-600">
          {c.name}
        </Link>
      ),
      exportValue: (c) => c.name,
    },
    {
      key: "username",
      header: "Username",
      cell: (c) => <span className="font-mono text-xs">{c.username}</span>,
      exportValue: (c) => c.username,
    },
    {
      key: "expiry",
      header: "Expiry",
      cell: (c) => <span className="text-xs">{formatDate(c.expiryDate)}</span>,
      exportValue: (c) => formatDate(c.expiryDate),
    },
    {
      key: "status",
      header: "Status",
      align: "right",
      cell: (c) => <StatusBadge status={c.connectionStatus} />,
      exportValue: (c) => c.connectionStatus,
    },
  ];

  return (
    <DataTableShell
      columns={columns}
      rows={rows}
      rowKey={(c) => c.id}
      compact
      className="border-0"
      empty={<EmptyState title="No subscribers yet" description="Customers assigned to this package will appear here." />}
    />
  );
}
