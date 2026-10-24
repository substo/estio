import { realmClerkIdWhere, realmEmailWhere, type AuthRealm } from "./auth-realm";

/** Verified identity from one realm's Clerk application. */
export type RealmClerkIdentity = {
  clerkId: string;
  email: string | null | undefined;
  firstName?: string | null;
  lastName?: string | null;
};

type RealmUserRow = { id: string; authRealm: AuthRealm; email: string; clerkId: string | null; firstName: string | null; lastName: string | null };

/** The subset of the Prisma user delegate this module needs, so tests can fake it. */
export interface RealmUserStore {
  user: {
    findUnique(args: { where: ReturnType<typeof realmClerkIdWhere> | ReturnType<typeof realmEmailWhere> }): Promise<RealmUserRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<RealmUserRow>;
    create(args: { data: Record<string, unknown> }): Promise<RealmUserRow>;
  };
}

/**
 * Resolve or create the Business user for a signed-in Clerk identity.
 * Lookups are (realm, clerkId) first, then a same-realm email claim of an
 * invited or placeholder user, exactly as before realms existed. There is no
 * fallback to another realm: a conflicting row elsewhere makes the write fail.
 */
export async function ensureRealmUser(store: RealmUserStore, realm: AuthRealm, identity: RealmClerkIdentity): Promise<RealmUserRow | null> {
  const email = identity.email;
  if (!identity.clerkId || !email) return null;
  const firstName = identity.firstName || null;
  const lastName = identity.lastName || null;

  let user = await store.user.findUnique({ where: realmClerkIdWhere(realm, identity.clerkId) });
  if (user) {
    const needsUpdate = (firstName && user.firstName !== firstName) || (lastName && user.lastName !== lastName);
    if (!needsUpdate) return user;
    return store.user.update({
      where: { id: user.id },
      data: { firstName: firstName || user.firstName, lastName: lastName || user.lastName },
    });
  }

  user = await store.user.findUnique({ where: realmEmailWhere(realm, email) });
  if (user) {
    console.log(`[Auth Sync] Linking existing ${realm} user ${email} to Clerk ID ${identity.clerkId}`);
    return store.user.update({
      where: { id: user.id },
      data: { clerkId: identity.clerkId, firstName: firstName || user.firstName, lastName: lastName || user.lastName },
    });
  }

  console.log(`[Auth Sync] Creating new ${realm} user for ${email}`);
  return store.user.create({ data: { authRealm: realm, email, clerkId: identity.clerkId, firstName, lastName } });
}
