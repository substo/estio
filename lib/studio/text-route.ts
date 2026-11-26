import "server-only";
import { Prisma } from "@prisma/client";
import { AiRoutingError, resolveLocationAiRoute, toStudioTextRoute, type StudioTextOperation } from "@/lib/ai/routing-service";
import type { AiConnectionKind } from "@/lib/ai/workflow-capabilities";
import type { StudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import { studioDb } from "./studio-db";
import type { StudioTextProvider } from "./text-provider";

/** "My Mac subscription" may use Codex or Claude on the requester's own Mac and nothing else: never a hosted or paid step. */
export const MAC_SUBSCRIPTION_KINDS: readonly AiConnectionKind[] = ["device_codex", "device_claude"];

/** The provider chosen in Connected computer → Setup is tried first; the other subscription is the fallback. */
export async function macPreferredKind(access: StudioAccess): Promise<AiConnectionKind | null> {
  const row = await studioDb.one<{ provider: string | null }>(Prisma.sql`
    select desired_config->>'textProvider' as provider from studio.studio_devices
    where location_id=${access.locationId} and app=${access.app} and created_by=${access.userId} and revoked_at is null order by seen_at desc nulls last limit 1`);
  return row?.provider === "codex" ? "device_codex" : row?.provider === "claude" ? "device_claude" : null;
}

export async function resolveStudioTextCommand<T extends { provider: StudioTextProvider }>(
  access: StudioAccess,
  operation: StudioTextOperation,
  command: T,
) {
  if (command.provider === "openai") return command;
  try {
    if (command.provider === "subscription") {
      // Admitted through the same ordered route as the Location order, limited to this Mac's subscriptions. A limit on Codex
      // (or Claude) moves the work to the other one before generation starts; it never reaches a paid API.
      const decision = await resolveLocationAiRoute(access.locationId, operation, { access, only: MAC_SUBSCRIPTION_KINDS, first: await macPreferredKind(access) });
      return { ...command, provider: "location_order" as const, confirmRoute: true, confirmSubscription: true, route: toStudioTextRoute(decision) };
    }
    const decision = await resolveLocationAiRoute(access.locationId, operation, { access });
    return { ...command, route: toStudioTextRoute(decision) };
  } catch (error) {
    if (error instanceof AiRoutingError) throw new StudioCommandError(error.message, error.status);
    throw error;
  }
}
