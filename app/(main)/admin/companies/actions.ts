'use server';

import { z } from 'zod';
import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';

const createCompanySchema = z.object({
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().optional(),
    website: z.string().optional(),
    locationId: z.string().min(1, 'Location ID is required'),
    type: z.string().optional(),
});

export type CompanyFormState = {
    errors?: {
        name?: string[];
        email?: string[];
        phone?: string[];
        website?: string[];
        locationId?: string[];
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
        locationId?: string[];
        confirmationName?: string[];
        _form?: string[];
    };
    deletedCompanyId?: string;
};

export async function createCompany(
    prevState: CompanyFormState,
    formData: FormData
): Promise<CompanyFormState> {
    const validatedFields = createCompanySchema.safeParse({
        name: formData.get('name'),
        email: formData.get('email'),
        phone: formData.get('phone'),
        website: formData.get('website'),
        locationId: formData.get('locationId'),
        type: formData.get('type'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing Fields. Failed to Create Company.',
            success: false,
        };
    }

    const { name, email, phone, website, locationId, type } = validatedFields.data;

    const { userId } = await auth();
    if (!userId) {
        return { success: false, message: 'Unauthorized' };
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        return { success: false, message: 'Unauthorized: You do not have access to this location.' };
    }

    try {
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
        console.error('[createCompany] Database Error:', error);
        return {
            message: 'Database Error: Failed to Create Company.',
            success: false,
        };
    }
}

const updateCompanySchema = z.object({
    companyId: z.string().min(1, 'Company ID is required'),
    name: z.string().min(1, 'Name is required'),
    email: z.string().email('Invalid email address').optional().or(z.literal('')),
    phone: z.string().optional(),
    website: z.string().optional(),
    locationId: z.string().min(1, 'Location ID is required'),
    type: z.string().optional(),
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
        locationId: formData.get('locationId'),
        type: formData.get('type'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing Fields. Failed to Update Company.',
            success: false,
        };
    }

    const { companyId, name, email, phone, website, locationId, type } = validatedFields.data;

    const { userId } = await auth();
    if (!userId) {
        return { success: false, message: 'Unauthorized' };
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        return { success: false, message: 'Unauthorized: You do not have access to this location.' };
    }

    // Verify company belongs to location
    const existingCompany = await db.company.findUnique({
        where: { id: companyId },
        select: { locationId: true }
    });

    if (!existingCompany || existingCompany.locationId !== locationId) {
        return { success: false, message: 'Company not found or access denied.' };
    }

    try {
        await db.company.update({
            where: { id: companyId },
            data: {
                name,
                email: email || null,
                phone: phone || null,
                website: website || null,
                type: type || null,
            },
        });

        revalidatePath('/admin/companies');
        return {
            message: 'Company updated successfully.',
            success: true,
        };
    } catch (error) {
        console.error('[updateCompany] Database Error:', error);
        return {
            message: 'Database Error: Failed to Update Company.',
            success: false,
        };
    }
}

const deleteCompanySchema = z.object({
    companyId: z.string().min(1, 'Company ID is required'),
    locationId: z.string().min(1, 'Location ID is required'),
    confirmationName: z.string().min(1, 'Please type the company name to confirm deletion'),
});

export async function deleteCompany(
    prevState: DeleteCompanyState,
    formData: FormData
): Promise<DeleteCompanyState> {
    const validatedFields = deleteCompanySchema.safeParse({
        companyId: formData.get('companyId'),
        locationId: formData.get('locationId'),
        confirmationName: formData.get('confirmationName'),
    });

    if (!validatedFields.success) {
        return {
            errors: validatedFields.error.flatten().fieldErrors,
            message: 'Missing fields. Failed to delete company.',
            success: false,
        };
    }

    const { companyId, locationId, confirmationName } = validatedFields.data;

    const { userId } = await auth();
    if (!userId) {
        return { success: false, message: 'Unauthorized' };
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        return { success: false, message: 'Unauthorized: You do not have access to this location.' };
    }

    const existingCompany = await db.company.findFirst({
        where: {
            id: companyId,
            locationId,
        },
        select: {
            id: true,
            name: true,
        },
    });

    if (!existingCompany) {
        return { success: false, message: 'Company not found or access denied.' };
    }

    if (existingCompany.name !== confirmationName.trim()) {
        return {
            success: false,
            errors: {
                confirmationName: ['Entered name does not match the company name.'],
            },
            message: 'Confirmation name does not match.',
        };
    }

    try {
        await db.$transaction(async (tx) => {
            await tx.companyPropertyRole.deleteMany({
                where: { companyId },
            });

            await tx.contactCompanyRole.deleteMany({
                where: { companyId },
            });

            await tx.propertyFeed.deleteMany({
                where: { companyId },
            });

            await tx.company.delete({
                where: { id: companyId },
            });
        });

        revalidatePath('/admin/companies');
        revalidatePath(`/admin/companies/${companyId}/view`);

        return {
            success: true,
            message: 'Company deleted successfully.',
            deletedCompanyId: companyId,
        };
    } catch (error) {
        console.error('[deleteCompany] Database Error:', error);
        return {
            success: false,
            message: 'Database Error: Failed to delete company.',
        };
    }
}

// FEED ACTIONS
const feedSchema = z.object({
    companyId: z.string().min(1),
    url: z.string().url(),
    format: z.string(),
    mappingConfig: z.string().optional(), // JSON string
});

export async function addFeed(prevState: any, formData: FormData) {
    const validated = feedSchema.safeParse({
        companyId: formData.get('companyId'),
        url: formData.get('url'),
        format: formData.get('format'),
        mappingConfig: formData.get('mappingConfig'),
    });

    if (!validated.success) {
        return { success: false, message: 'Invalid feed data' };
    }

    const { userId } = await auth();
    if (!userId) return { success: false, message: 'Unauthorized' };

    try {
        await db.propertyFeed.create({
            data: {
                companyId: validated.data.companyId,
                url: validated.data.url,
                format: validated.data.format as any,
                mappingConfig: validated.data.mappingConfig ? JSON.parse(validated.data.mappingConfig) : undefined,
                isActive: true
            }
        });
        revalidatePath('/admin/companies');
        return { success: true, message: 'Feed added successfully' };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function deleteFeed(feedId: string) {
    const { userId } = await auth();
    if (!userId) return { success: false, message: 'Unauthorized' };

    try {
        await db.propertyFeed.delete({ where: { id: feedId } });
        revalidatePath('/admin/companies');
        return { success: true, message: 'Feed deleted' };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}

export async function toggleFeedStatus(feedId: string, isActive: boolean) {
    const { userId } = await auth();
    if (!userId) return { success: false, message: 'Unauthorized' };

    try {
        await db.propertyFeed.update({
            where: { id: feedId },
            data: { isActive }
        });
        revalidatePath('/admin/companies');
        return { success: true };
    } catch (e: any) {
        return { success: false, message: e.message };
    }
}
