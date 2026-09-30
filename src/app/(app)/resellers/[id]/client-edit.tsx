"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ResellerForm } from "@/components/resellers/reseller-views";
import { Handshake } from "lucide-react";

/**
 * The edit button and its modal together.
 *
 * A server component cannot hold the open/closed state a modal needs, so the
 * button and the dialog live together here rather than the page mounting a
 * dialog that nothing opens.
 */
export function ClientEdit({
  reseller,
  areas,
}: {
  reseller: {
    id: string;
    name: string;
    phone: string | null;
    areaId: string | null;
    commissionPct: number;
    status: string;
  };
  areas: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Edit reseller
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Edit ${reseller.name}`}
        icon={<Handshake className="size-4" />}
        size="lg"
      >
        <ResellerForm areas={areas} reseller={reseller} />
      </Modal>
    </>
  );
}
