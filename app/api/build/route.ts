import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import { sameOrigin } from "@/lib/build/contract";
import { body, failure, response } from "@/lib/build/http";
import { guidanceDoc, jobFile, operator, operatorCommand, snapshot } from "@/lib/build/store";
import { pastTalks, talk, talkOwner, talkOwnerCommand, talks } from "@/lib/build/talk";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  if (!await getPlatformAdminContext()) return response({ error: "Forbidden" }, 403);
  try {
    const params = new URL(request.url).searchParams, doc = params.get("doc"), job = params.get("job"), file = params.get("file");
    if (doc) return response(await guidanceDoc(doc));
    if (job && file) return response(await jobFile(job, file));
    const one = params.get("talk");
    if (one) return response(await talk(one));
    const [state, conversations, past] = await Promise.all([snapshot(), talks(), pastTalks()]);
    return response({ ...state, talks: conversations, pastTalks: past });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const actor = await getPlatformAdminContext();
  if (!actor || !sameOrigin(request)) return response({ error: "Forbidden" }, 403);
  try {
    const input = await body(request);
    if (typeof input?.action === "string" && input.action.startsWith("talk")) return response(await talkOwner(talkOwnerCommand.parse(input), actor.internalUserId));
    return response(await operator(operatorCommand.parse(input), actor.internalUserId));
  } catch (error) { return failure(error); }
}
