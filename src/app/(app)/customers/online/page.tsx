import type { Metadata } from "next";
import { CustomerOnlinePage } from "@/components/customers/customer-pages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Online Users" };

export default async function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CustomerOnlinePage searchParams={props.searchParams} />;
}
