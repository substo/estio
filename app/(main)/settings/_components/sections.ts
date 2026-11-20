/**
 * Settings shared by Estio CRM and Studio, one entry per section under /settings. Later phases move the remaining CRM and
 * Studio settings pages here as siblings (/settings/integrations, /settings/computer, …); add them to this list.
 */
export type SettingsSection = { href: string; label: string; description: string };
export const SETTINGS_SECTIONS: SettingsSection[] = [
  { href: "/settings/ai", label: "AI", description: "Connections, models per task, fallback order, and usage and limits." },
];
