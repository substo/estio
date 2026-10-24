import { Webhook } from "svix";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { authRealmForHostBrand, realmEmailWhere, type AuthRealm } from "./auth-realm";
import { getHostBrandConfig, resolveHostBrand } from "./host-brand";

/**
 * Per-realm signing configuration for the Business Clerk webhook. Estio keeps
 * its existing `CLERK_WEBHOOK_SECRET`; Substo has its own secret. When an
 * instance ID is configured, the signed event must come from that Clerk
 * instance (required for Substo, optional for Estio to keep its behaviour).
 */
const REALM_WEBHOOK_ENV: Record<AuthRealm, { secret: string; instance: string; instanceRequired: boolean }> = {
  estio: { secret: "CLERK_WEBHOOK_SECRET", instance: "ESTIO_CLERK_INSTANCE_ID", instanceRequired: false },
  substo: { secret: "SUBSTO_CLERK_WEBHOOK_SECRET", instance: "SUBSTO_CLERK_INSTANCE_ID", instanceRequired: true },
};

export type VerifiedClerkBusinessEvent = { realm: AuthRealm; event: WebhookEvent; svixId: string };

const otherRealm = (realm: AuthRealm): AuthRealm => (realm === "estio" ? "substo" : "estio");

/**
 * Verify a Business Clerk webhook against the signing secret of the realm
 * that owns the request host. The realm never comes from the payload, so an
 * event signed by one realm cannot be accepted as, or act on, the other.
 */
export async function verifyClerkBusinessWebhook(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
): Promise<VerifiedClerkBusinessEvent | Response> {
  const realm = authRealmForHostBrand(resolveHostBrand(request.headers.get("host"), getHostBrandConfig(env)));
  const config = REALM_WEBHOOK_ENV[realm];
  const secret = env[config.secret]?.trim();
  const otherSecret = env[REALM_WEBHOOK_ENV[otherRealm(realm)].secret]?.trim();
  const instance = env[config.instance]?.trim();
  if (!secret || secret === otherSecret || (config.instanceRequired && !instance)) {
    console.error(`[Webhook] Clerk webhook is not configured for the ${realm} realm.`);
    return new Response("Webhook is not configured for this realm", { status: 503 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Error occured -- no svix headers", { status: 400 });
  }

  let event: WebhookEvent;
  try {
    // Verify the exact received bytes, not a re-serialization.
    const body = await request.text();
    event = new Webhook(secret).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error verifying webhook:", err);
    return new Response("Error occured", { status: 400 });
  }

  const eventInstance = (event as { instance_id?: unknown }).instance_id;
  if (instance && eventInstance !== instance) {
    console.error(`[Webhook] Rejected Clerk event from another instance for the ${realm} realm.`);
    return new Response("Error occured", { status: 400 });
  }
  return { realm, event, svixId };
}

/**
 * Public tenant sign-ups and contact phone sync belong to Estio's tenant sites,
 * which only use the Estio realm.
 */
export function realmHandlesTenantContacts(realm: AuthRealm): boolean {
  return realm === "estio";
}

/**
 * The webhook's team-invite branch is Estio's (GHL sync, location from
 * invitation metadata). Substo claims brand invitations at sign-in instead.
 */
export function realmAcceptsTeamInvites(realm: AuthRealm): boolean {
  return realm === "estio";
}

export type InvitedUserClaim = {
  clerkId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  locationId: string;
};

export interface InvitedUserStore {
  user: {
    upsert(args: {
      where: ReturnType<typeof realmEmailWhere>;
      update: Record<string, unknown>;
      create: Record<string, unknown>;
    }): Promise<{ id: string }>;
  };
}

/**
 * Accepting a team invitation claims the invited user by email, as before
 * realms, but only within the realm whose Clerk instance signed the event.
 */
export function claimInvitedRealmUser(store: InvitedUserStore, realm: AuthRealm, claim: InvitedUserClaim) {
  return store.user.upsert({
    where: realmEmailWhere(realm, claim.email),
    update: {
      clerkId: claim.clerkId,
      firstName: claim.firstName || undefined,
      lastName: claim.lastName || undefined,
      locations: { connect: { id: claim.locationId } },
    },
    create: {
      authRealm: realm,
      email: claim.email,
      clerkId: claim.clerkId,
      firstName: claim.firstName || null,
      lastName: claim.lastName || null,
      locations: { connect: { id: claim.locationId } },
    },
  });
}
