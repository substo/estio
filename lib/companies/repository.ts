import db from "@/lib/db";
import { Prisma } from "@prisma/client";

export interface ListCompaniesParams {
    locationId: string;
    q?: string;
    type?: string;
    hasRole?: string;
}

export async function listCompanies(params: ListCompaniesParams) {
    const { locationId, q, type, hasRole } = params;

    const where: Prisma.CompanyWhereInput = {
        locationId,
    };

    if (q) {
        where.AND = {
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
                { website: { contains: q, mode: 'insensitive' } },
            ],
        };
    }

    if (type && type !== 'all') {
        where.type = type;
    }

    if (hasRole === 'has-properties') {
        where.propertyRoles = { some: {} };
    } else if (hasRole === 'has-contacts') {
        where.contactRoles = { some: {} };
    }

    return db.company.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
            propertyRoles: { include: { property: true } },
            contactRoles: { include: { contact: true } },
            feeds: true,
        },
    });
}
