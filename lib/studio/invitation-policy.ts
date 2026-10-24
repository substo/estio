export interface StudioInvitationState {
  email: string;
  expires_at: string;
  revoked_at: string | null;
  accepted_at: string | null;
  accepted_by_clerk_user_id: string | null;
}

export function studioInvitationStatus(
  invitation: StudioInvitationState | null,
  userId: string,
  now = Date.now(),
): "pending" | "accepted" | "used" | "invalid" {
  if (!invitation || invitation.revoked_at) return "invalid";
  if (invitation.accepted_at) return invitation.accepted_by_clerk_user_id === userId ? "accepted" : "used";
  const expiry = Date.parse(invitation.expires_at);
  return Number.isFinite(expiry) && expiry > now ? "pending" : "invalid";
}
