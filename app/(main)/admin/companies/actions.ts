'use server';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { getLocationContext } from '@/lib/auth/location-context';
import {
    CompanyAccessDeniedError,
    createCompanyAccessPolicy,
    createCompanyFeedAccessPolicy,
} from '@/lib/companies/repository';
import {
    companyIdSchema,
    feedMappingConfigSchema,
    feedUrlSchema,
} from '@/lib/feed/feed-route-schemas';

const companyAccess = createCompanyAccessPolicy({
    getAuthenticatedUserId: async () => (await auth()).userId,
    getActiveLocationId: async () => (await getLocationContext())?.id || null,
    findCompanyInLocation: (companyId, locationId) => db.company.findFirst({
        where: { id: companyId, locationId },
        select: { id: true, name: true },
    }),
});

const feedAccess = createCompanyFeedAccessPolicy({
    requireActiveContext: companyAccess.requireActiveContext,
    findFeedInLocation: (feedId, locationId) => db.propertyFeed.findFirst({
        where: { id: feedId, company: { locationId } },
        select: { id: true, companyId: true },
    }),
});

const optionalText = z.preprocess((value) => String(value ?? '').trim(), z.string());
const optionalEmail = z.preprocess(
    (value) => String(value ?? '').trim(),
    z.string().email('Invalid email address').or(z.literal('')),
);

const createCompanySchema = z.object({
    name: z.string().trim().min(1, 'Name is required'),
    email: optionalEmail,
    phone: optionalText,
    website: optionalText,
    type: optionalText,
});

export type CompanyFormState = {
    errors?: {
        name?: string[];
        email?: string[];
        phone?: string[];
        website?: string[];
        type?: string[];
        _form?: string[];
    };
    message?: string;
    success?: boolean;
    company?: { id: string; name: string };
};

export type DeleteCompanyState = {
    success?: boolean;
    message?: string;
    errors?: {
        companyId?: string[];
        confirmationName?: string[];
        _form?: string[];
    };
    deletedCompanyId?: string;
};

class CompanyConfirmationMismatchError extends Error {
    constructor() {
        super('Company confirmation name mismatch');
        this.name = 'CompanyConfirmationMismatchError';
    }
}

export async function createCompany(
    prevState: CompanyFormState,
    formData: FormData
): Promise<CompanyFormState> {
    const validatedFields = createCompanySchema.safeParse({
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        website: formData.get('website'),
        type: formData.get('type'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing Fields. Failed to Create Company.',
            success: false,
        };
    }

    const { name, email, phone, website, type } = validatedFields.data;

    try {
        const { locationId } = await companyAccess.requireActiveContext();
        const company = await db.company.create({
            data: {
                name,
                email: email || null,
                phone: phone || null,
                website: website || null,
                locationId,
                type: type || null,
            },
        });

        revalidatePath('/admin/companies');
        return {
            message: 'Company created successfully.',
            success: true,
            company: { id: company.id, name: company.name },
        };
    } catch (error) {
        if (error instanceof CompanyAccessDeniedError) return { success: false, message: 'Unauthorized' };
        console.error('[createCompany] Database Error:', error);
        return {
            message: 'Database Error: Failed to Create Company.',
            success: false,
        };
    }
}

const updateCompanySchema = z.object({
    companyId: z.string().min(1, 'Company ID is required'),
    name: z.string().trim().min(1, 'Name is required'),
    email: optionalEmail,
    phone: optionalText,
    website: optionalText,
    type: optionalText,
});

export async function updateCompany(
    prevState: CompanyFormState,
    formData: FormData
): Promise<CompanyFormState> {
    const validatedFields = updateCompanySchema.safeParse({
        companyId: formData.get('companyId'),
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        website: formData.get('website'),
        type: formData.get('type'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing Fields. Failed to Update Company.',
            success: false,
        };
    }

    const { companyId, name, email, phone, website, type } = validatedFields.data;

    try {
        const { locationId } = await companyAccess.requireCompany(companyId);
        const result = await db.company.updateMany({
            where: { id: companyId, locationId },
            data: {
                name,
                email: email || null,
                phone: phone || null,
                website: website || null,
                type: type || null,
            },
        });
        if (result.count !== 1) throw new CompanyAccessDeniedError();

        revalidatePath('/admin/companies');
        return {
            message: 'Company updated successfully.',
            success: true,
        };
    } catch (error) {
        if (error instanceof CompanyAccessDeniedError) return { success: false, message: 'Company not found or access denied.' };
        console.error('[updateCompany] Database Error:', error);
        return {
            message: 'Database Error: Failed to Update Company.',
            success: false,
        };
    }
}

const deleteCompanySchema = z.object({
    companyId: z.string().min(1, 'Company ID is required'),
    confirmationName: z.string().min(1, 'Please type the company name to confirm deletion'),
});

export async function deleteCompany(
    prevState: DeleteCompanyState,
    formData: FormData
): Promise<DeleteCompanyState> {
    const validatedFields = deleteCompanySchema.safeParse({
        companyId: formData.get('companyId'),
        confirmationName: formData.get('confirmationName'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing fields. Failed to delete company.',
            success: false,
        };
    }

    const { companyId, confirmationName } = validatedFields.data;
    let locationId: string;
    try {
        locationId = (await companyAccess.requireCompany(companyId)).locationId;
    } catch (error) {
        if (error instanceof CompanyAccessDeniedError) return { success: false, message: 'Company not found or access denied.' };
        throw error;
    }

    try {
        await db.$transaction(async (tx) => {
            const existingCompany = await tx.company.findFirst({
                where: { id: companyId, locationId },
                select: { name: true },
            });
            if (!existingCompany) throw new CompanyAccessDeniedError();
            if (existingCompany.name !== confirmationName.trim()) {
                throw new CompanyConfirmationMismatchError();
            }

            await tx.companyPropertyRole.deleteMany({
                where: { companyId },
            });

            await tx.contactCompanyRole.deleteMany({
                where: { companyId },
            });

            await tx.propertyFeed.deleteMany({
                where: { companyId },
            });

            const deleted = await tx.company.deleteMany({
                where: { id: companyId, locationId },
            });
            if (deleted.count !== 1) throw new CompanyAccessDeniedError();
        });

        revalidatePath('/admin/companies');
        revalidatePath(`/admin/companies/${companyId}/view`);

        return {
            success: true,
            message: 'Company deleted successfully.',
            deletedCompanyId: companyId,
        };
    } catch (error) {
        if (error instanceof CompanyAccessDeniedError) {
            return { success: false, message: 'Company not found or access denied.' };
        }
        if (error instanceof CompanyConfirmationMismatchError) {
            return {
                success: false,
                errors: {
                    confirmationName: ['Entered name does not match the company name.'],
                },
                message: 'Confirmation name does not match.',
            };
        }
        console.error('[deleteCompany] Database Error:', error);
        return {
            success: false,
            message: 'Database Error: Failed to delete company.',
        };
    }
}

// FEED ACTIONS
const feedSchema = z.object({
    companyId: companyIdSchema,
    url: feedUrlSchema,
    format: z.enum(['GENERIC', 'ALTIA', 'KYERO']),
    mappingConfig: z.preprocess(
        (value) => value == null || value === '' ? undefined : value,
        z.string().optional(),
    ),
});

type FeedActionState = { success: boolean; message: string };

class DuplicateCompanyFeedError extends Error {
    constructor() {
        super('Duplicate company feed');
        this.name = 'DuplicateCompanyFeedError';
    }
}

function matchesCanonicalFeedUrl(existingUrl: string, canonicalUrl: string) {
    const parsed = feedUrlSchema.safeParse(existingUrl);
    return parsed.success ? parsed.data === canonicalUrl : existingUrl.trim() === canonicalUrl;
}

export async function addFeed(_prevState: FeedActionState, formData: FormData): Promise<FeedActionState> {
    const validated = feedSchema.safeParse({
        companyId: formData.get('companyId'),
        url: formData.get('url'),
        format: formData.get('format'),
        mappingConfig: formData.get('mappingConfig'),
    });

    if (!validated.success) {
        return { success: false, message: 'Invalid feed data.' };
    }

    let mappingConfig: Prisma.InputJsonObject | undefined;
    if (validated.data.mappingConfig) {
        try {
            const parsed = JSON.parse(validated.data.mappingConfig);
            const validatedMapping = feedMappingConfigSchema.safeParse(parsed);
            if (!validatedMapping.success) return { success: false, message: 'Invalid feed mapping.' };
            mappingConfig = validatedMapping.data as Prisma.InputJsonObject;
        } catch {
            return { success: false, message: 'Invalid feed mapping.' };
        }
    }
    if (validated.data.format === 'GENERIC' && !mappingConfig) {
        return { success: false, message: 'A valid mapping is required for generic feeds.' };
    }

    try {
        await companyAccess.requireCompany(validated.data.companyId);
        for (let attempt = 0; attempt < 2; attempt += 1) {
            try {
                await db.$transaction(async (transaction) => {
                    const existingFeeds = await transaction.propertyFeed.findMany({
                        where: { companyId: validated.data.companyId },
                        select: { url: true },
                    });
                    if (existingFeeds.some((feed) => matchesCanonicalFeedUrl(feed.url, validated.data.url))) {
                        throw new DuplicateCompanyFeedError();
                    }

                    await transaction.propertyFeed.create({
                        data: {
                            companyId: validated.data.companyId,
                            url: validated.data.url,
                            format: validated.data.format,
                            mappingConfig,
                            isActive: true,
                        },
                    });
                }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
                break;
            } catch (error) {
                const canRetry = error instanceof Prisma.PrismaClientKnownRequestError
                    && error.code === 'P2034'
                    && attempt === 0;
                if (!canRetry) throw error;
            }
        }
        revalidatePath('/admin/companies');
        revalidatePath(`/admin/companies/${validated.data.companyId}/view`);
        return { success: true, message: 'Feed added successfully.' };
    } catch (error) {
        if (error instanceof CompanyAccessDeniedError) return { success: false, message: 'Company not found or access denied.' };
        if (error instanceof DuplicateCompanyFeedError) return { success: false, message: 'This feed is already configured for the company.' };
        console.error('[addFeed] Database Error:', error);
        return { success: false, message: 'Failed to add feed.' };
    }
}

export async function deleteFeed(feedId: string): Promise<FeedActionState> {
    try {
        const { locationId, feed } = await feedAccess.requireFeed(feedId);
        const result = await db.propertyFeed.deleteMany({
            where: { id: feed.id, company: { locationId } },
        });
        if (result.count !== 1) throw new CompanyAccessDeniedError();
        revalidatePath('/admin/companies');
        revalidatePath(`/admin/companies/${feed.companyId}/view`);
        return { success: true, message: 'Feed deleted.' };
    } catch (error) {
        if (error instanceof CompanyAccessDeniedError) return { success: false, message: 'Feed not found or access denied.' };
        console.error('[deleteFeed] Database Error:', error);
        return { success: false, message: 'Failed to delete feed.' };
    }
}

const toggleFeedSchema = z.object({
    feedId: z.string().trim().min(1),
    isActive: z.boolean(),
});

export async function toggleFeedStatus(feedId: string, isActive: boolean): Promise<FeedActionState> {
    const validated = toggleFeedSchema.safeParse({ feedId, isActive });
    if (!validated.success) return { success: false, message: 'Invalid feed status.' };
    try {
        const { locationId, feed } = await feedAccess.requireFeed(validated.data.feedId);
        const result = await db.propertyFeed.updateMany({
            where: { id: feed.id, company: { locationId } },
            data: { isActive: validated.data.isActive },
        });
        if (result.count !== 1) throw new CompanyAccessDeniedError();
        revalidatePath('/admin/companies');
        revalidatePath(`/admin/companies/${feed.companyId}/view`);
        return { success: true, message: 'Feed status updated.' };
    } catch (error) {
        if (error instanceof CompanyAccessDeniedError) return { success: false, message: 'Feed not found or access denied.' };
        console.error('[toggleFeedStatus] Database Error:', error);
        return { success: false, message: 'Failed to update feed status.' };
    }
}
