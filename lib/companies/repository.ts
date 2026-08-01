import db from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface ListCompaniesParams {
    locationId: string;
    contactVisibilityWhere: Prisma.ContactWhereInput;
    q?: string;
    type?: string;
    hasRole?: string;
}

export class CompanyAccessDeniedError extends Error {
    constructor() {
        super("Company access denied");
        this.name = "CompanyAccessDeniedError";
    }
}

export function createCompanyAccessPolicy(dependencies: {
    getAuthenticatedUserId: () => Promise<string | null>;
    getActiveLocationId: () => Promise<string | null>;
    findCompanyInLocation: (companyId: string, locationId: string) => Promise<{ id: string; name: string } | null>;
}) {
    async function requireActiveContext() {
        const userId = await dependencies.getAuthenticatedUserId();
        if (!userId) throw new CompanyAccessDeniedError();

        const locationId = await dependencies.getActiveLocationId();
        if (!locationId) throw new CompanyAccessDeniedError();
        return { userId, locationId };
    }

    async function requireCompany(companyId: string) {
        const context = await requireActiveContext();
        const company = await dependencies.findCompanyInLocation(companyId, context.locationId);
        if (!company) throw new CompanyAccessDeniedError();
        return { ...context, company };
    }

    return { requireActiveContext, requireCompany };
}

export function createCompanyFeedAccessPolicy(dependencies: {
    requireActiveContext: () => Promise<{ userId: string; locationId: string }>;
    findFeedInLocation: (feedId: string, locationId: string) => Promise<{ id: string; companyId: string } | null>;
}) {
    async function requireFeed(feedId: string) {
        const normalizedFeedId = String(feedId || '').trim();
        if (!normalizedFeedId) throw new CompanyAccessDeniedError();

        const context = await dependencies.requireActiveContext();
        const feed = await dependencies.findFeedInLocation(normalizedFeedId, context.locationId);
        if (!feed) throw new CompanyAccessDeniedError();
        return { ...context, feed };
    }

    return { requireFeed };
}

export function buildCompanyWhere(params: ListCompaniesParams): Prisma.CompanyWhereInput {
    const { locationId, contactVisibilityWhere, q, type, hasRole } = params;
    const where: Prisma.CompanyWhereInput = {
        locationId,
    };

    const query = q?.trim();
    if (query) {
        where.AND = {
            OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { email: { contains: query, mode: 'insensitive' } },
                { phone: { contains: query, mode: 'insensitive' } },
                { website: { contains: query, mode: 'insensitive' } },
            ],
        };
    }

    if (type && type !== 'all') {
        where.type = type;
    }

    if (hasRole === 'has-properties') {
        where.propertyRoles = { some: { property: { locationId } } };
    } else if (hasRole === 'has-contacts') {
        where.contactRoles = { some: { contact: contactVisibilityWhere } };
    }

    return where;
}

export function safeCompanyWebsite(value: string | null): string | null {
    if (!value) return null;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
        return null;
    }
}

export async function listCompanies(params: ListCompaniesParams) {
    const { locationId, contactVisibilityWhere } = params;

    return db.company.findMany({
        where: buildCompanyWhere(params),
        orderBy: { createdAt: 'desc' },
        include: {
            propertyRoles: {
                where: { property: { locationId } },
                include: { property: true },
            },
            contactRoles: {
                where: { contact: contactVisibilityWhere },
                include: { contact: true },
            },
            feeds: { select: { id: true } },
        },
    });
}
