import { body, failure, response, workerAuthorized } from "@/lib/build/http";
import { mutate } from "@/lib/build/store";
import { externalCommand, setStory, storyCommand, trackExternal } from "@/lib/build/external";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (!workerAuthorized(request)) return response({ error: "Forbidden" }, 403);
  try {
    const raw = await body(request);
    // {"action":"story"} sets the readable story of any Build record; anything else is an external-work report.
    if (raw?.action === "story") { const input = storyCommand.parse(raw); return response(await mutate(tx => setStory(tx, input.id, input.story, "worker"))); }
    const input = externalCommand.parse(raw);
    return response(await mutate(tx => trackExternal(tx, input)));
  } catch (error) { return failure(error); }
}
