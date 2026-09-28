import type { Metadata } from "next";
import { CustomerExpiringPage } from "@/components/customers/customer-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Expiring Soon" };

export default async function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CustomerExpiringPage searchParams={props.searchParams} />;
}
