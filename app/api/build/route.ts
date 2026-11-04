import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import { sameOrigin } from "@/lib/build/contract";
import { body, failure, response } from "@/lib/build/http";
import { operator, operatorCommand, snapshot } from "@/lib/build/store";
import { talkOwner, talkOwnerCommand, talks } from "@/lib/build/talk";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!await getPlatformAdminContext()) return response({ error: "Forbidden" }, 403);
  try { const [state, conversations] = await Promise.all([snapshot(), talks()]); return response({ ...state, talks: conversations }); } catch (error) { return failure(error); }
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
