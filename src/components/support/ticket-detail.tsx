"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/states";
import { useToast } from "@/components/providers";
import { formatDate, formatDateTime } from "@/lib/utils";
import { TICKET_PRIORITIES, TICKET_STATUSES } from "@/lib/enums";
import { addTicketCommentAction, assignTicketAction, updateTicketAction } from "@/app/(app)/support/actions";
import { Paperclip, MessageSquare, Save, Send, UserCheck, Lock, History, Gauge } from "lucide-react";
import { UsageVsPackagePanel, type UsageTotals } from "@/components/customers/usage-graph";

type Ticket = {
  id: string;
  ticketNumber: string;
  subject: string;
  problem: string;
  category: string;
  description: string | null;
  priority: string;
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  closedAt: Date | null;
  customer: {
    id: string;
    name: string;
    username: string;
    customerCode: string;
    phone: string;
    address: string | null;
    area: { name: string } | null;
    package: { name: string; downloadSpeed: number | null; uploadSpeed: number | null } | null;
    router: { name: string } | null;
  } | null;
  technician: { id: string; name: string; phone: string; role: string; status: string } | null;
  area: { name: string } | null;
  createdBy: { name: string } | null;
  comments: { id: string; authorName: string; body: string; isInternal: boolean; createdAt: Date }[];
};

type Technician = { id: string; name: string; phone: string; role: string; status: string };

type Activity = { id: string; action: string; summary: string; createdAt: Date; actor: string };

export function TicketDetailView({
  ticket,
  technicians,
  activity,
  usage,
}: {
  ticket: Ticket;
  technicians: Technician[];
  activity: Activity[];
  /**
   * Present only for a speed complaint, and only when the customer has usage on
   * file. `null` means "we have nothing to show", which is itself a finding — a
   * customer complaining about a slow line with no recorded traffic may be
   * disconnected rather than slow.
   */
  usage: UsageTotals | null;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [tab, setTab] = useState("conversation");
  const [comment, setComment] = useState("");
  const [resolution, setResolution] = useState("");

  // Speed complaints are where usage evidence actually changes the answer, so it
  // is shown there and nowhere else.
  const isSpeedComplaint =
    ticket.category === "Slow Internet" ||
    /\bslow\b/i.test(ticket.subject) ||
    /\bslow\b/i.test(ticket.problem);

  const run = async (fn: () => Promise<{ success?: string; formError?: string }>, ok: string) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r.formError) error(r.formError);
      else {
        success(r.success ?? ok);
        setComment("");
        setResolution("");
        startTransition(() => router.refresh());
      }
    } catch (e) {
      error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={ticket.status} />
                  <StatusBadge status={ticket.priority} />
                  <Badge>{ticket.category}</Badge>
                </div>
                <h2 className="mt-2 text-lg font-semibold">{ticket.subject}</h2>
                <p className="mt-1 text-sm text-fg-muted">
                  Opened {formatDateTime(ticket.createdAt)}
                  {ticket.createdBy ? ` by ${ticket.createdBy.name}` : ""}
                </p>
              </div>
            </div>

            {ticket.description ? (
              <p className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-sm leading-relaxed">
                {ticket.description}
              </p>
            ) : null}

            {ticket.resolvedAt || ticket.closedAt ? (
              <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
                {ticket.resolvedAt ? <span>Resolved {formatDate(ticket.resolvedAt)}</span> : null}
                {ticket.closedAt ? <span>Closed {formatDate(ticket.closedAt)}</span> : null}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Status">
                <Select
                  value={ticket.status}
                  onChange={(e) => run(() => updateTicketAction(ticket.id, { status: e.target.value }), "Status updated")}
                  options={TICKET_STATUSES.map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Priority">
                <Select
                  value={ticket.priority}
                  onChange={(e) => run(() => updateTicketAction(ticket.id, { priority: e.target.value }), "Priority updated")}
                  options={TICKET_PRIORITIES.map((p) => ({ value: p, label: p }))}
                />
              </Field>
              <Field label="Assigned technician">
                <Select
                  value={ticket.technician?.id ?? ""}
                  onChange={(e) => run(() => assignTicketAction(ticket.id, e.target.value), "Technician assigned")}
                  placeholder="Unassigned"
                  options={technicians.map((t) => ({ value: t.id, label: `${t.name} — ${t.status}` }))}
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Tabs
          value={tab}
          onValueChange={setTab}
          items={[
            { value: "conversation", label: "Conversation", count: ticket.comments.length },
            { value: "notes", label: "Internal Notes" },
            { value: "activity", label: "Activity", count: activity.length },
            { value: "resolution", label: "Resolution" },
          ]}
        />

        {tab === "conversation" ? (
          <Card>
            <CardHeader title="Conversation" description="Messages exchanged with the customer" icon={<MessageSquare />} />
            <CardBody className="space-y-4">
              {ticket.comments.filter((c) => !c.isInternal).length === 0 ? (
                <EmptyState title="No replies yet" description="Add the first reply below." />
              ) : (
                <ol className="space-y-3">
                  {ticket.comments
                    .filter((c) => !c.isInternal)
                    .map((c) => (
                      <li key={c.id} className="rounded-lg border border-[var(--border)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{c.authorName}</span>
                          <span className="text-xs text-fg-subtle">{formatDateTime(c.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg-muted">{c.body}</p>
                      </li>
                    ))}
                </ol>
              )}

              <div className="space-y-2 border-t border-[var(--border)] pt-4">
                <Field label="Reply to the customer">
                  <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    icon={<Send className="size-4" />}
                    loading={busy}
                    disabled={!comment.trim()}
                    onClick={() => run(() => addTicketCommentAction(ticket.id, comment, false), "Reply added")}
                  >
                    Send reply
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {tab === "notes" ? (
          <Card>
            <CardHeader title="Internal Notes" description="Only visible to staff" icon={<Lock />} />
            <CardBody className="space-y-4">
              {ticket.comments.filter((c) => c.isInternal).length === 0 ? (
                <EmptyState title="No internal notes" />
              ) : (
                <ol className="space-y-3">
                  {ticket.comments
                    .filter((c) => c.isInternal)
                    .map((c) => (
                      <li key={c.id} className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{c.authorName}</span>
                          <span className="text-xs text-fg-subtle">{formatDateTime(c.createdAt)}</span>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-fg-muted">{c.body}</p>
                      </li>
                    ))}
                </ol>
              )}

              <div className="space-y-2 border-t border-[var(--border)] pt-4">
                <Field label="New note">
                  <Textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
                </Field>
                <div className="flex justify-end">
                  <Button
                    variant="secondary"
                    icon={<Lock className="size-4" />}
                    loading={busy}
                    disabled={!comment.trim()}
                    onClick={() => run(() => addTicketCommentAction(ticket.id, comment, true), "Note added")}
                  >
                    Add note
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {tab === "activity" ? (
          <Card>
            <CardHeader title="Activity" description="Audited operations on this customer" icon={<History />} />
            <CardBody className="p-0">
              {activity.length === 0 ? (
                <EmptyState title="No activity recorded" />
              ) : (
                <ol className="divide-y divide-[var(--border)]">
                  {activity.map((a) => (
                    <li key={a.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Badge>{a.action}</Badge>
                      <span className="min-w-0 flex-1 truncate">{a.summary}</span>
                      <span className="shrink-0 text-xs text-fg-subtle">
                        {formatDateTime(a.createdAt)} · {a.actor}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        ) : null}

        {tab === "resolution" ? (
          <Card>
            <CardHeader title="Resolution" description="Closing note — also added to the conversation" />
            <CardBody className="space-y-3">
              <Field label="What was done" hint="Diagnostics, part replaced, config changed...">
                <Textarea rows={5} value={resolution} onChange={(e) => setResolution(e.target.value)} />
              </Field>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  loading={busy}
                  disabled={!resolution.trim()}
                  onClick={() => run(() => updateTicketAction(ticket.id, { resolution }), "Resolution saved")}
                  icon={<Save className="size-4" />}
                >
                  Save note
                </Button>
                <Button
                  variant="success"
                  loading={busy}
                  disabled={!resolution.trim()}
                  onClick={() =>
                    run(
                      () => updateTicketAction(ticket.id, { resolution, status: "Resolved" }),
                      "Ticket resolved"
                    )
                  }
                >
                  Save and resolve
                </Button>
                <Button
                  variant="primary"
                  loading={busy}
                  disabled={!resolution.trim()}
                  onClick={() =>
                    run(
                      () => updateTicketAction(ticket.id, { resolution, status: "Closed" }),
                      "Ticket closed"
                    )
                  }
                >
                  Save and close
                </Button>
              </div>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <div className="space-y-4">
        {isSpeedComplaint ? (
          <UsageVsPackagePanel
            totals={
              usage ?? {
                downloadBytes: "0",
                uploadBytes: "0",
                onlineMinutes: 0,
                peak: null,
                daysWithUsage: 0,
              }
            }
            packageDownload={ticket.customer?.package?.downloadSpeed ?? null}
            packageUpload={ticket.customer?.package?.uploadSpeed ?? null}
          />
        ) : null}

        <Card>
          <CardHeader title="Customer" icon={<Gauge className="size-4" />} />
          <CardBody>
            {ticket.customer ? (
              <div className="space-y-3">
                <Link href={`/customers/${ticket.customer.id}`} className="block text-sm font-medium hover:text-brand-600">
                  {ticket.customer.name}
                </Link>
                <p className="font-mono text-xs text-fg-muted">{ticket.customer.username}</p>
                <p className="tnum text-xs text-fg-muted">{ticket.customer.phone}</p>
                {ticket.customer.address ? <p className="text-xs text-fg-muted">{ticket.customer.address}</p> : null}
                <div className="space-y-1.5 border-t border-[var(--border)] pt-3 text-xs">
                  <Line label="Customer ID" value={ticket.customer.customerCode} />
                  <Line label="Package" value={ticket.customer.package?.name ?? "—"} />
                  <Line label="Area" value={ticket.customer.area?.name ?? "—"} />
                  <Line label="Router" value={ticket.customer.router?.name ?? "—"} />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={() => router.push(`/customers/${ticket.customer!.id}?tab=complaints`)}>
                    Profile
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => router.push(`/billing/payments/new?customerId=${ticket.customer!.id}`)}>
                    Collect
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-fg-muted">Walk-in complaint — no customer record linked.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Assignment" icon={<UserCheck />} />
          <CardBody className="space-y-2.5 text-sm">
            <Line label="Technician" value={ticket.technician?.name ?? "Unassigned"} />
            {ticket.technician ? <Line label="Contact" value={ticket.technician.phone} /> : null}
            <Line label="Area" value={ticket.area?.name ?? "—"} />
            <Line label="Category" value={ticket.category} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Links" icon={<Paperclip />} />
          <CardBody className="space-y-2 text-sm">
            {ticket.customer ? (
              <>
                <Link href={`/customers/${ticket.customer.id}?tab=billing`} className="block text-brand-600 hover:underline">
                  View customer billing
                </Link>
                <Link href={`/customers/${ticket.customer.id}?tab=usage`} className="block text-brand-600 hover:underline">
                  View usage &amp; sessions
                </Link>
              </>
            ) : null}
            <Link href="/support/tickets" className="block text-fg-muted hover:underline">
              Back to all tickets
            </Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-fg-muted">{label}</span>
      <span className="truncate text-right font-medium">{value}</span>
    </div>
  );
}
