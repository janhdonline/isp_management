import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  const session = await getSession();
  redirect(session ? "/dashboard" : "/login");
}
