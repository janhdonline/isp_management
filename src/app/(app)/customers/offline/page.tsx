import type { Metadata } from "next";
import { CustomerOfflinePage } from "@/components/customers/customer-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offline Customers" };

export default async function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CustomerOfflinePage searchParams={props.searchParams} />;
}
