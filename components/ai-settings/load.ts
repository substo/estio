import "server-only";
import { AiRoutingError, getLocationAiRouting } from "@/lib/ai/routing-service";
import { getStudioAiSettings } from "@/lib/studio/ai-settings";
import type { AiSettingsLinks, LocationAiSettingsProps } from "./location-ai-settings-view";

/**
 * Server loader for <LocationAiSettings>. Pass the active Location the caller already resolved; access (member to view,
 * Location admin signed in as themselves to edit) is checked again here. Returns null when the viewer has no access.
 */
export async function loadLocationAiSettings(locationId: string, links: AiSettingsLinks): Promise<LocationAiSettingsProps | null> {
  try {
    const [routing, settings] = await Promise.all([getLocationAiRouting(locationId), getStudioAiSettings(locationId)]);
    if (!settings) return null;
    return { locationId: settings.access.locationId, routing, openAiKey: settings.openai ? { keyHint: settings.openai.keyHint } : null, encryptionReady: settings.encryptionReady, links };
  } catch (error) {
    if (error instanceof AiRoutingError && error.status === 403) return null;
    throw error;
  }
}

/** Connection management links each app can open. Substo cannot open the Estio CRM integration pages. */
export function aiSettingsLinks(app: "estio" | "substo"): AiSettingsLinks {
  return app === "estio"
    ? { computer: "/settings/computer", gemini: "/settings/integrations/gemini", chatgpt: "/settings/integrations/chatgpt-subscription" }
    : { computer: "/settings/computer" };
}
