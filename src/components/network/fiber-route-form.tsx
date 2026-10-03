"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MapRoute } from "@/lib/services/fiber";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/providers";

/**
 * Record and remove fiber runs.
 *
 * An existing route is loaded into the same form for editing rather than getting a
 * row of controls of its own — a route's points are a single ordered value, and
 * the one thing an editor must not do is silently reorder them.
 */
export function FiberRouteForm({
  olts,
  routes,
}: {
  olts: { id: string; name: string }[];
  routes: MapRoute[];
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const current = routes.find((r) => r.id === editing) ?? null;

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const fd = new FormData(e.currentTarget);
    try {
      const { saveFiberRouteAction } = await import("@/app/(app)/network/fiber-map/actions");
      const res = await saveFiberRouteAction(editing, Object.fromEntries(fd));
      if (res.formError) setFormError(res.formError);
      else {
        success(res.success ?? "Saved");
        setEditing(null);
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    setBusy(true);
    try {
      const { deleteFiberRouteAction } = await import("@/app/(app)/network/fiber-map/actions");
      const res = await deleteFiberRouteAction(id);
      if (res.formError) error(res.formError);
      else {
        success(res.success ?? "Deleted");
        if (editing === id) setEditing(null);
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
      void name;
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Route name" required>
            <Input
              name="name"
              key={current?.id ?? "new"}
              defaultValue={current?.name ?? ""}
              placeholder="Mirpur DO-4 feeder"
            />
          </Field>
          <Field label="From OLT">
            <Select
              name="oltId"
              key={`olt-${current?.id ?? "new"}`}
              defaultValue={current?.olt ?? ""}
              placeholder="Not linked"
              options={olts.map((o) => ({ value: o.id, label: o.name }))}
            />
          </Field>
        </div>
        <Field
          label="Points, in order"
          required
          hint='One JSON array. Each entry needs numeric lat and lng — for example [{"lat":23.78,"lng":90.41},{"lat":23.79,"lng":90.42}].'
          error={formError ?? undefined}
        >
          <Textarea
            name="points"
            rows={3}
            key={`pts-${current?.id ?? "new"}`}
            defaultValue={current ? JSON.stringify(current.points) : ""}
            placeholder='[{"lat":23.78,"lng":90.41}]'
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button type="submit" loading={busy}>
            {current ? "Save route" : "Add route"}
          </Button>
          {current ? (
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>

      {routes.length > 0 ? (
        <ul className="space-y-1">
          {routes.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="font-medium">{r.name}</span>
                <span className="ml-2 text-xs text-fg-muted">
                  {r.points.length} point{r.points.length === 1 ? "" : "s"}
                  {r.olt ? ` · ${r.olt}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEditing(r.id)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(r.id, r.name)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}