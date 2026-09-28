import type { Metadata } from "next";
import { CustomerDuePage } from "@/components/customers/customer-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Due Customers" };

export default async function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CustomerDuePage searchParams={props.searchParams} />;
}
