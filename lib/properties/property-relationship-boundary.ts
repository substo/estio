type PropertyRelationships = {
    contactRoles?: Array<{ contact?: { locationId?: string | null } | null }>;
    companyRoles?: Array<{ company?: { locationId?: string | null } | null }>;
};

export function filterPropertyRelationshipsToLocation<T extends PropertyRelationships>(
    property: T,
    locationId: string,
): T {
    return {
        ...property,
        contactRoles: property.contactRoles?.filter((role) => role.contact?.locationId === locationId),
        companyRoles: property.companyRoles?.filter((role) => role.company?.locationId === locationId),
    } as T;
}
