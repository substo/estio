/** Plan for retiring SiteConfig.googleAiApiKey: copy to the encrypted Location secret unless one exists, then clear. */
export type PlaintextKeyRow = { locationId: string; hasPlaintext: boolean; hasSecret: boolean };
export type PlaintextKeyAction = { locationId: string; action: "copy-then-clear" | "clear-only" };
export function planPlaintextKeyMoves(rows: PlaintextKeyRow[]): PlaintextKeyAction[] {
  return rows.filter(r => r.hasPlaintext).map(r => ({ locationId: r.locationId, action: r.hasSecret ? "clear-only" as const : "copy-then-clear" as const }));
}
