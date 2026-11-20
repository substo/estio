import "server-only";
import { AiRoutingError, withStudioTextRoute, type StudioTextOperation } from "@/lib/ai/routing-service";
import type { StudioAccess } from "./access";
import { StudioCommandError } from "./command-error";
import type { StudioTextProvider } from "./text-provider";

export async function resolveStudioTextCommand<T extends { provider: StudioTextProvider }>(
  access: StudioAccess,
  operation: StudioTextOperation,
  command: T,
) {
  if (command.provider !== "location_order") return command;
  try {
    return await withStudioTextRoute(access.locationId, operation, command, access);
  } catch (error) {
    if (error instanceof AiRoutingError) throw new StudioCommandError(error.message, error.status);
    throw error;
  }
}
