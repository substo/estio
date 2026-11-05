/**
 * Where onboarding lives in each product and how the owner leaves it for later. Client-safe and pure.
 * The screen is one shared component; the CRM and Studio each show it inside their own shell.
 */
export const ONBOARDING_LATER_COOKIE = "onboarding_later";
export const onboardingPath = (product: "crm" | "studio") => product === "studio" ? "/studio/onboarding" : "/admin/onboarding";

export type ConnectLink = { label: string; description: string; href: string };
/** Screens where an admin connects an AI the Location owns. Substo has no CRM integrations screen, so it uses Studio's. */
export function connectLinks(app: "estio" | "substo"): ConnectLink[] {
  const mac = { label: "A Mac with Codex or Claude", description: "Pair a Mac signed in to your ChatGPT or Claude subscription.", href: "/studio/settings/computer" };
  if (app === "substo") return [
    { label: "OpenAI API key", description: "Add your own OpenAI key and a monthly budget.", href: "/studio/settings/ai" },
    mac,
  ];
  return [
    { label: "ChatGPT subscription", description: "Connect your ChatGPT plan (Codex); no API key needed.", href: "/admin/settings/integrations/chatgpt-subscription" },
    { label: "OpenAI API key", description: "Add your own OpenAI key.", href: "/admin/settings/integrations/openai-api" },
    mac,
  ];
}

/** The landing screens open onboarding unless the owner chose "Later" for this Location in this browser session. */
export const deferredFor = (cookieValue: string | undefined, locationId: string) => cookieValue === locationId;
