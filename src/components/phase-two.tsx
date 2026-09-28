import Link from "next/link";
import { PageHeader, PageContainer } from "@/components/layout/page-header";
import { Card, CardBody } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Construction, ArrowLeft } from "lucide-react";

export function PhaseTwoPage({
  title,
  description,
  module,
  features,
}: {
  title: string;
  description: string;
  module: string;
  features: string[];
}) {
  return (
    <>
      <PageHeader
        title={title}
        description={description}
        breadcrumb={[{ label: title }]}
      />
      <PageContainer>
        <Card className="mx-auto max-w-2xl">
          <CardBody className="flex flex-col items-center gap-4 py-12 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400">
              <Construction className="size-6" />
            </span>
            <div>
              <h2 className="text-base font-semibold">{module} ships in Phase 2</h2>
              <p className="mx-auto mt-1.5 max-w-md text-sm text-fg-muted">
                The data model, services and permissions for this module are already in place. The
                screens below are the remaining work.
              </p>
            </div>
            <ul className="w-full max-w-md space-y-1.5 text-left">
              {features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-fg-muted">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
                  {f}
                </li>
              ))}
            </ul>
            <Button variant="outline" icon={<ArrowLeft className="size-4" />} className="mt-2">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </CardBody>
        </Card>
      </PageContainer>
    </>
  );
}
