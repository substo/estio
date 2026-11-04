import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import { sameOrigin } from "@/lib/build/contract";
import { body, failure, response } from "@/lib/build/http";
import { operator, operatorCommand, snapshot } from "@/lib/build/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  if (!await getPlatformAdminContext()) return response({ error: "Forbidden" }, 403);
  try { return response(await snapshot()); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const actor = await getPlatformAdminContext();
  if (!actor || !sameOrigin(request)) return response({ error: "Forbidden" }, 403);
  try { return response(await operator(operatorCommand.parse(await body(request)), actor.internalUserId)); } catch (error) { return failure(error); }
}
