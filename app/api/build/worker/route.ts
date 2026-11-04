import { body, failure, response, workerAuthorized } from "@/lib/build/http";
import { worker, workerCommand, reconcile } from "@/lib/build/store";
import { scanSpec } from "@/lib/build/scanner";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!workerAuthorized(request)) return response({ error: "Forbidden" }, 403);
  try {
    const input = await body(request);
    if (input.action === "reconcile") {
      const { z } = await import("zod");
      const parsed = z.object({ action: z.literal("reconcile"), scan: scanSpec }).strict().parse(input);
      return response(await reconcile(parsed.scan));
    }
    return response(await worker(workerCommand.parse(input)));
  } catch (error) { return failure(error); }
}
