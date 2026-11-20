import { isSubstoSettingsPage } from "@/lib/auth/settings-route-policy";

export type SettingsSection = { href: string; label: string; description: string; adminOnly?: boolean; adminOnlyIn?: "estio" | "substo"; firstPartyOnly?: boolean };

const SETTINGS_SECTIONS: SettingsSection[] = [
  { href: "/settings/general", label: "General", description: "Business profile and name." },
  { href: "/settings/ai", label: "AI", description: "Connections, models, fallback order, and usage limits.", firstPartyOnly: true },
  { href: "/settings/computer", label: "Connected computer", description: "Pair and manage the Mac that runs Studio jobs.", firstPartyOnly: true },
  { href: "/settings/team", label: "Team", description: "Members, roles, and invitations.", adminOnlyIn: "estio" },
  { href: "/settings/notifications", label: "Notifications", description: "Task reminders, quiet hours, and browser push." },
  { href: "/settings/website", label: "Website", description: "Theme, contact details, and site navigation.", adminOnlyIn: "substo" },
  { href: "/settings/integrations", label: "Integrations", description: "CRM, messaging, and workspace connections." },
  { href: "/settings/conversations", label: "Conversations", description: "Drafting and transcription controls.", adminOnly: true },
  { href: "/settings/contacts", label: "Contacts", description: "Contact classification and enrichment.", adminOnly: true },
  { href: "/settings/live-assist", label: "Live Assist", description: "Live Assist preferences and operational controls.", adminOnly: true },
  { href: "/settings/property-media", label: "Property media", description: "AI models for listing images and audio.", adminOnly: true },
  { href: "/settings/prospecting", label: "Prospecting", description: "External lead sources and scraping schedules." },
  { href: "/settings/media", label: "Media", description: "Restore or purge images in the media trash.", adminOnly: true },
  { href: "/settings/location-data", label: "Location data", description: "Review the records retained or removed by cleanups.", adminOnly: true },
];

export function visibleSettingsSections(app: "estio" | "substo", role: "ADMIN" | "MEMBER", tenantHost: boolean) {
  return SETTINGS_SECTIONS.filter((section) =>
    (app !== "substo" || isSubstoSettingsPage(section.href))
    && (!tenantHost || !section.firstPartyOnly)
    && (!(section.adminOnly || section.adminOnlyIn === app) || role === "ADMIN"));
}
