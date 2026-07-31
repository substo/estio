import { auth } from '@clerk/nextjs/server';
import { getLocationContext } from '@/lib/auth/location-context';
import db from '@/lib/db';

export type ActiveProspectingAccess = {
  userId: string;
  locationId: string;
};

export async function getActiveProspectingAccess(
  assertedLocationId?: string | null,
  dependencies: {
    getClerkUserId?: () => Promise<string | null>;
    getActiveLocationId?: () => Promise<string | null>;
    getInternalUserId?: (clerkUserId: string) => Promise<string | null>;
  } = {},
): Promise<ActiveProspectingAccess | null> {
  const clerkUserId = dependencies.getClerkUserId
    ? await dependencies.getClerkUserId()
    : (await auth()).userId;
  if (!clerkUserId) return null;

  const locationId = dependencies.getActiveLocationId
    ? await dependencies.getActiveLocationId()
    : (await getLocationContext())?.id || null;
  if (!locationId) return null;

  const asserted = String(assertedLocationId || '').trim();
  if (asserted && asserted !== locationId) return null;

  const userId = dependencies.getInternalUserId
    ? await dependencies.getInternalUserId(clerkUserId)
    : (await db.user.findUnique({ where: { clerkId: clerkUserId }, select: { id: true } }))?.id || null;
  return userId ? { userId, locationId } : null;
}

export function requireAllRequestedIds(
  requestedIds: string[],
  authorizedIds: string[],
): string[] | null {
  const requested = [...new Set(requestedIds.map((id) => String(id || '').trim()).filter(Boolean))];
  const authorized = new Set(authorizedIds);
  return requested.every((id) => authorized.has(id)) ? requested : null;
}
