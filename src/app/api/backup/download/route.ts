import { AuthError, requirePermissionFromRequest } from "@/lib/auth";
import { backupPath } from "@/lib/services/backup";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

export const dynamic = "force-dynamic";

/**
 * Streams a stored backup to the browser. The path is rebuilt from the
 * directory and the basename alone, so a crafted `file` parameter cannot walk
 * out of the backups folder.
 */
export async function GET(request: Request) {
  try {
    await requirePermissionFromRequest(request, "settings.view");
  } catch (e) {
    const status = e instanceof AuthError ? 401 : 403;
    return Response.json(
      { error: status === 401 ? "Unauthorized" : "Forbidden" },
      { status },
    );
  }

  const file = new URL(request.url).searchParams.get("file");
  if (!file)
    return Response.json({ error: "No file specified." }, { status: 400 });

  const path = await backupPath(file);
  try {
    const info = await stat(path);
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;

    return new Response(stream, {
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(info.size),
        "content-disposition": `attachment; filename="${path.split("/").pop()}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "That file is no longer on disk." },
      { status: 404 },
    );
  }
}
