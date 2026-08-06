import type { ContactAccessScope, PlatformRole, UserRole } from "@prisma/client";

export type AuthorizedLocation = {
  id: string;
  name: string | null;
  role: UserRole;
  contactAccessScope: ContactAccessScope;
};

export type LocationAuthorityInput = {
  connectedLocations: Array<{ id: string; name: string | null }>;
  roles: Array<{ locationId: string; role: UserRole; contactAccessScope: ContactAccessScope }>;
};

export type ActiveLocationSelection =
  | { status: "no_access"; location: null }
  | { status: "selection_required"; location: null }
  | { status: "authorized"; location: AuthorizedLocation };

export function intersectAuthorizedLocations(input: LocationAuthorityInput): AuthorizedLocation[] {
  const connected = new Map(input.connectedLocations.map((location) => [location.id, location]));
  const rolesByLocation = new Map<string, LocationAuthorityInput["roles"]>();
  for (const role of input.roles) {
    rolesByLocation.set(role.locationId, [...(rolesByLocation.get(role.locationId) || []), role]);
  }

  return [...connected.values()]
    .flatMap((location): AuthorizedLocation[] => {
      const roles = rolesByLocation.get(location.id) || [];
      if (roles.length !== 1) return [];
      return [{ ...location, role: roles[0].role, contactAccessScope: roles[0].contactAccessScope }];
    })
    .sort((left, right) => (left.name || "").localeCompare(right.name || "") || left.id.localeCompare(right.id));
}

export function chooseActiveLocation(locations: AuthorizedLocation[], cookieLocationId?: string | null): ActiveLocationSelection {
  if (locations.length === 0) return { status: "no_access", location: null };
  if (locations.length === 1) return { status: "authorized", location: locations[0] };
  const requested = String(cookieLocationId || "").trim();
  const selected = locations.find((location) => location.id === requested);
  return selected ? { status: "authorized", location: selected } : { status: "selection_required", location: null };
}

export function isPlatformAdministrator(platformRole: PlatformRole): boolean {
  return platformRole === "PLATFORM_ADMIN";
}
