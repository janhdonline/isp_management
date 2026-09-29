import type { Metadata } from "next";
import Link from "next/link";
import { PageContainer } from "@/components/layout/page-header";
import { ForgotPasswordForm } from "@/components/auth/password-reset";
import { requestResetAction } from "./reset-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Forgot Password" };

export default function ForgotPasswordPage() {
  return (
    <PageContainer className="flex min-h-[70vh] items-center justify-center py-10">
      <div className="w-full">
        <ForgotPasswordForm action={requestResetAction} />
        <p className="mt-4 text-center text-sm text-fg-muted">
          Remembered it?{" "}
          <Link href="/login" className="font-medium text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </PageContainer>
  );
}
