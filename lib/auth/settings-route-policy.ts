/** Reviewed settings pages available on both Estio and Substo. */
const SUBSTO_SETTINGS_PAGES = new Set([
  "/settings",
  "/settings/ai",
  "/settings/computer",
  "/settings/general",
  "/settings/notifications",
  "/settings/team",
]);

export function isSettingsPath(pathname: string): boolean {
  return pathname === "/settings" || pathname.startsWith("/settings/");
}

export function isSubstoSettingsPage(pathname: string): boolean {
  return SUBSTO_SETTINGS_PAGES.has(pathname);
}
