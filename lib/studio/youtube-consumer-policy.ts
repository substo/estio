/** Google profile grants never substitute for workspace membership, or vice versa. */
export function sameYoutubePrincipal(profile: { brand: string; userId: string } | null, workspace: { brand: string; userId: string } | null): boolean {
  return Boolean(profile && workspace && profile.brand === workspace.brand && profile.userId === workspace.userId);
}
