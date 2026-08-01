import { auth } from '@clerk/nextjs/server';
import { getLocationContext } from '@/lib/auth/location-context';
import type { ContactAccessScope, Prisma, UserRole } from '@prisma/client';
import db from '@/lib/db';

export type ActiveContactsAccess = {
  userId: string; // Clerk ID, retained for existing attribution/integration callers.
  internalUserId: string;
  locationId: string;
  role: UserRole;
  contactAccessScope: ContactAccessScope;
};

export type ContactScope = 'my' | 'location';

export async function getActiveContactsAccess(
  assertedLocationId?: string | null,
  dependencies: {
    getAuthUserId?: () => Promise<string | null>;
    getActiveLocationId?: () => Promise<string | null>;
    findActor?: (clerkUserId: string, locationId: string) => Promise<{
      id: string;
      connected: boolean;
      role: UserRole | null;
      contactAccessScope: ContactAccessScope | null;
    } | null>;
  } = {}
): Promise<ActiveContactsAccess | null> {
  const userId = dependencies.getAuthUserId
    ? await dependencies.getAuthUserId()
    : (await auth()).userId;
  if (!userId) return null;

  const locationId = dependencies.getActiveLocationId
    ? await dependencies.getActiveLocationId()
    : (await getLocationContext())?.id || null;
  if (!locationId) return null;

  const asserted = String(assertedLocationId || '').trim();
  if (asserted && asserted !== locationId) return null;

  const actor = dependencies.findActor
    ? await dependencies.findActor(userId, locationId)
    : await db.user.findUnique({
        where: { clerkId: userId },
        select: {
          id: true,
          locations: { where: { id: locationId }, select: { id: true } },
          locationRoles: { where: { locationId }, select: { role: true, contactAccessScope: true } },
        },
      }).then((record) => record ? ({
        id: record.id,
        connected: record.locations.length === 1,
        role: record.locationRoles.length === 1 ? record.locationRoles[0].role : null,
        contactAccessScope: record.locationRoles.length === 1 ? record.locationRoles[0].contactAccessScope : null,
      }) : null);

  if (!actor?.connected || !actor.role || !actor.contactAccessScope) return null;
  return { userId, internalUserId: actor.id, locationId, role: actor.role, contactAccessScope: actor.contactAccessScope };
}

export function canViewLocationContacts(access: ActiveContactsAccess): boolean {
  return access.role === 'ADMIN' || access.contactAccessScope === 'LOCATION_WIDE';
}

export function resolveContactScope(access: ActiveContactsAccess, requestedScope?: string | null): ContactScope {
  return canViewLocationContacts(access) && requestedScope === 'location' ? 'location' : 'my';
}

export function buildContactVisibilityWhere(
  access: ActiveContactsAccess,
  requestedScope?: string | null,
): Prisma.ContactWhereInput {
  return {
    locationId: access.locationId,
    ...(resolveContactScope(access, requestedScope) === 'my'
      ? { assignedUserId: access.internalUserId }
      : {}),
  };
}

export function buildContactManageWhere(access: ActiveContactsAccess): Prisma.ContactWhereInput {
  return {
    locationId: access.locationId,
    ...(access.role === 'ADMIN' ? {} : { assignedUserId: access.internalUserId }),
  };
}

export function canManageContact(access: ActiveContactsAccess, assignedUserId: string | null): boolean {
  return access.role === 'ADMIN' || assignedUserId === access.internalUserId;
}

export function canUpdateMemberContactAccess(actorRole: UserRole, targetRole: UserRole): boolean {
  return actorRole === 'ADMIN' && targetRole === 'MEMBER';
}

export function canAssignContactTo(access: ActiveContactsAccess, assignedUserId: string | null): boolean {
  return access.role === 'ADMIN' || assignedUserId === access.internalUserId;
}

type ContactRelationshipInput = {
  roleType?: string | null;
  entityId?: string | null;
  entityIds?: string[] | null;
  leadAssignedToAgent?: string | null;
  propertiesInterested?: string[] | null;
  propertiesInspected?: string[] | null;
  propertiesEmailed?: string[] | null;
  propertiesMatched?: string[] | null;
};

export type ContactRelationshipRepository = {
  findPropertyIds(locationId: string, ids: string[]): Promise<string[]>;
  findCompanyIds(locationId: string, ids: string[]): Promise<string[]>;
  findUserIds(locationId: string, ids: string[]): Promise<string[]>;
};

export async function validateContactRelationships(
  repository: ContactRelationshipRepository,
  locationId: string,
  data: ContactRelationshipInput
): Promise<Record<string, string[]> | null> {
  const propertyFields = [
    'propertiesInterested',
    'propertiesInspected',
    'propertiesEmailed',
    'propertiesMatched',
  ] as const;
  const propertyIds = new Set<string>();

  for (const field of propertyFields) {
    for (const id of data[field] || []) propertyIds.add(String(id));
  }
  if (data.roleType === 'property') {
    for (const id of data.entityIds || []) propertyIds.add(String(id));
    if (data.entityId) propertyIds.add(String(data.entityId));
  }

  const errors: Record<string, string[]> = {};
  if (propertyIds.size > 0) {
    const validIds = new Set(await repository.findPropertyIds(locationId, [...propertyIds]));
    if ([...propertyIds].some((id) => !validIds.has(id))) {
      errors.entityIds = ['One or more selected properties are unavailable for this location.'];
    }
  }

  if (data.roleType === 'company' && data.entityId) {
    const validIds = await repository.findCompanyIds(locationId, [String(data.entityId)]);
    if (!validIds.includes(String(data.entityId))) {
      errors.entityId = ['The selected company is unavailable for this location.'];
    }
  }

  if (data.leadAssignedToAgent) {
    const agentId = String(data.leadAssignedToAgent);
    const validIds = await repository.findUserIds(locationId, [agentId]);
    if (!validIds.includes(agentId)) {
      errors.leadAssignedToAgent = ['The selected agent is unavailable for this location.'];
    }
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
