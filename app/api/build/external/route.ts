import { body, failure, response, workerAuthorized } from "@/lib/build/http";
import { mutate } from "@/lib/build/store";
import { externalCommand, trackExternal } from "@/lib/build/external";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!workerAuthorized(request)) return response({ error: "Forbidden" }, 403);
  try {
    const input = externalCommand.parse(await body(request));
    return response(await mutate(tx => trackExternal(tx, input)));
  } catch (error) { return failure(error); }
}
