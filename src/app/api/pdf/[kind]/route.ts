import { requirePermissionFromRequest, AuthError } from "@/lib/auth";
import { invoicePdf, receiptPdf } from "@/lib/services/pdf";

export const dynamic = "force-dynamic";

/**
 * Streams a document as a PDF.
 *
 *   GET /api/pdf/invoice?id=...
 *   GET /api/pdf/receipt?id=...
 *
 * The id is required and the lookup is by primary key, so a caller cannot walk
 * the table by guessing; the permission check is the one that decides whether
 * this particular user may see the document at all.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.pathname.split("/").pop() ?? "";
  const id = url.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "An id is required." }, { status: 400 });
  }

  const wanted = kind === "receipt" ? "payments.export" : "billing.export";
  try {
    await requirePermissionFromRequest(request, wanted);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 403;
    return Response.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status }
    );
  }

  try {
    const { buffer, filename } =
      kind === "receipt" ? await receiptPdf(id) : await invoicePdf(id);

    return new Response(new Uint8Array(buffer), {
      headers: {
        "content-type": "application/pdf",
        "content-length": String(buffer.byteLength),
        "content-disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    // A missing document is a 404, not a 500: the client asked for something
    // that is not there, which is not a fault on the server.
    const message = e instanceof Error ? e.message : "Could not build the document";
    const missing = /record was not found|findUniqueOrThrow/i.test(message);
    return Response.json(
      { error: missing ? "No such document." : message },
      { status: missing ? 404 : 500 }
    );
  }
}
