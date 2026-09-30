"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Package as PackageIcon } from "lucide-react";
import { MovementDialog } from "./inventory-views";

/**
 * The header's "Record stock" action.
 *
 * A server component cannot hold the open/closed state the dialog needs, so the
 * button and the dialog live together here rather than the page mounting a dialog
 * that nothing opens.
 */
export function RecordStockButton({ item }: { item: Parameters<typeof MovementDialog>[0]["item"] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<PackageIcon className="size-4" />}>
        Record stock
      </Button>
      <MovementDialog item={item} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
