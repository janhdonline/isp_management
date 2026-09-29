import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/layout/page-header";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { KeyRound } from "lucide-react";
import { ResetPasswordForm } from "@/components/auth/password-reset";
import { completeResetAction, loadResetContext } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Set a New Password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const account = token ? await loadResetContext(token) : null;

  return (
    <PageContainer className="flex min-h-[70vh] items-center justify-center py-10">
      <div className="w-full">
        {account ? (
          <>
            <p className="mb-4 text-center text-sm text-fg-muted">
              Setting a new password for <span className="font-medium text-fg">{account.email}</span>
            </p>
            <ResetPasswordForm token={token} action={completeResetAction} />
          </>
        ) : (
          <Card className="max-w-md">
            <CardHeader title="Reset link expired" description="Something has to be wrong with a link that cannot be used." />
            <CardBody className="space-y-4 text-center">
              <div className="mx-auto flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
                <KeyRound className="size-5" />
              </div>
              <div>
                <p className="font-medium">This link is not valid</p>
                <p className="mt-1 text-sm text-fg-muted">
                  It may have already been used, or it may have expired. Links last 30 minutes.
                </p>
              </div>
              <Link
                href="/forgot-password"
                className="inline-block text-sm font-medium text-brand-600 hover:underline"
              >
                Request a new link
              </Link>
            </CardBody>
          </Card>
        )}
      </div>
    </PageContainer>
  );
}
