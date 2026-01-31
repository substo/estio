'use server';

import { z } from 'zod';
import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';
import {
  LEAD_GOALS, LEAD_PRIORITIES, LEAD_STAGES, LEAD_SOURCES,
  REQUIREMENT_STATUSES, REQUIREMENT_CONDITIONS, CONTACT_TYPES
} from '@/app/(main)/admin/contacts/_components/contact-types';
import { syncContactToGHL } from '@/lib/ghl/stakeholders';
import { syncContactToGoogle } from '@/lib/google/people';

// --- Helpers & Zod Transforms ---

/**
 * Normalizes phone numbers but preserves asterisks for masked numbers.
 * Allowed characters: digits, +, *, #, whitespace
 */
function normalizePhone(phone: string | null | undefined) {
  if (!phone) return null;
  // Allow digits, +, *, #
  let cleaned = phone.replace(/[^\d+*#]/g, '').trim();
  // Handle 00 prefix -> +
  if (cleaned.startsWith('00')) cleaned = '+' + cleaned.substring(2);
  return cleaned;
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

function parseArray(input: string | null | undefined): string[] {
  if (!input) return [];
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return parsed;
    return [String(parsed)];
  } catch (e) {
    // Fallback: split by comma if JSON parsing fails
    return input.split(',').map(s => s.trim()).filter(s => s.length > 0);
  }
}

// --- Helpers & Zod Transforms ---

function normalizeForDiff(val: any) {
  if (val === null || val === undefined || val === '') return null;
  if (val === '[]' || (Array.isArray(val) && val.length === 0)) return null; // Treat empty array/stringified empty array as null for diffing
  if (Array.isArray(val)) {
    // Sort array for consistent comparison
    return [...val].sort();
  }
  return val;
}

function areValuesEqual(a: any, b: any) {
  const normA = normalizeForDiff(a);
  const normB = normalizeForDiff(b);
  return JSON.stringify(normA) === JSON.stringify(normB);
}

async function enrichChangesWithReadableValues(changes: { field: string; old: any; new: any }[]) {
  const propertyIds = new Set<string>();
  const userIds = new Set<string>();

  const propertyFields = ['propertiesInterested', 'propertiesInspected', 'propertiesEmailed', 'propertiesMatched', 'entityIds'];

  for (const change of changes) {
    if (propertyFields.includes(change.field)) {
      const collect = (val: any) => {
        if (Array.isArray(val)) val.forEach(v => propertyIds.add(String(v)));
        else if (val) propertyIds.add(String(val));
      };
      collect(change.old);
      collect(change.new);
    }
    if (change.field === 'leadAssignedToAgent' || change.field === 'userId') {
      if (change.old) userIds.add(String(change.old));
      if (change.new) userIds.add(String(change.new));
    }
    if (change.field === 'propertyWonReference') {
      // Already readable, no op
    }
  }

  const properties = propertyIds.size > 0
    ? await db.property.findMany({ where: { id: { in: Array.from(propertyIds) } }, select: { id: true, reference: true, title: true } })
    : [];

  const users = userIds.size > 0
    ? await db.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, name: true, email: true } })
    : [];

  const propMap = new Map(properties.map(p => [p.id, p.reference || p.title || 'Unknown']));
  const userMap = new Map(users.map(u => [u.id, u.name || u.email || 'Unknown']));

  for (const change of changes) {
    if (propertyFields.includes(change.field)) {
      const mapVal = (val: any) => {
        if (Array.isArray(val)) return val.map(id => propMap.get(String(id)) || id);
        if (val) return propMap.get(String(val)) || val;
        return val;
      };
      change.old = mapVal(change.old);
      change.new = mapVal(change.new);
    }
    if (change.field === 'leadAssignedToAgent' || change.field === 'userId') {
      if (change.old) change.old = userMap.get(String(change.old)) || change.old;
      if (change.new) change.new = userMap.get(String(change.new)) || change.new;
    }
  }
}

// --- Schemas ---

const createContactSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().optional().transform(normalizePhone),
  locationId: z.string().min(1, 'Location ID is required'),
  message: z.string().optional(),
  contactType: z.enum(CONTACT_TYPES).optional().default('Lead'),

  // Role Data
  roleType: z.enum(['property', 'company']).optional(),
  entityId: z.string().optional(),
  entityIds: z.string().optional().transform(parseArray), // For Multi-Property
  roleName: z.string().optional(),

  // Lead Details
  leadGoal: z.enum(LEAD_GOALS).optional(),
  leadPriority: z.enum(LEAD_PRIORITIES).optional().default('Medium'),
  leadStage: z.enum(LEAD_STAGES).optional().default('Unassigned'),
  leadSource: z.string().optional(),
  leadNextAction: z.string().optional(),
  leadFollowUpDate: z.string().optional().transform(parseDate),
  leadAssignedToAgent: z.string().optional(),

  // Requirements
  requirementStatus: z.enum(REQUIREMENT_STATUSES).optional().default('For Sale'),
  requirementDistrict: z.string().optional().default('Any District'),
  requirementBedrooms: z.string().optional().default('Any Bedrooms'),
  requirementMinPrice: z.string().optional().default('Any'),
  requirementMaxPrice: z.string().optional().default('Any'),
  requirementCondition: z.enum(REQUIREMENT_CONDITIONS).optional().default('Any Condition'),
  requirementPropertyTypes: z.string().optional().transform(parseArray),
  requirementPropertyLocations: z.string().optional().transform(parseArray),
  requirementOtherDetails: z.string().optional(),

  // Matching
  matchingPropertiesToMatch: z.string().optional().default('Updated and New'),
  matchingEmailMatchedProperties: z.string().optional().default('Yes - Automatic'),
  matchingNotificationFrequency: z.string().optional().default('Weekly'),
  matchingLastMatchDate: z.string().optional().transform(parseDate),

  // Properties Tab
  propertiesInterested: z.string().optional().transform(parseArray),
  propertiesInspected: z.string().optional().transform(parseArray),
  propertiesEmailed: z.string().optional().transform(parseArray),
  propertiesMatched: z.string().optional().transform(parseArray),

  // Property Won
  propertyWonValue: z.string().transform((val) => (val ? parseFloat(val) : null)).optional(),
  wonCommission: z.string().transform((val) => (val ? parseFloat(val) : null)).optional(),
  propertyWonReference: z.string().optional(),
  propertyWonDate: z.string().optional().transform(parseDate),
});

const updateContactSchema = createContactSchema.extend({
  contactId: z.string().min(1, 'Contact ID is required'),
});

type ValidatedContactData = z.infer<typeof createContactSchema>;

export type CreateContactState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
  success?: boolean;
  contact?: { id: string; name: string; email?: string | null; phone?: string | null; message?: string | null };
};

// --- Logic Helpers ---

// Prepares the Prisma data object from validated Zod data
function prepareContactInput(data: ValidatedContactData) {
  return {
    name: data.name,
    email: data.email || null,
    phone: data.phone || null,
    message: data.message,
    contactType: data.contactType,

    leadGoal: data.leadGoal,
    leadPriority: data.leadPriority,
    leadStage: data.leadStage,
    leadSource: data.leadSource,
    leadNextAction: data.leadNextAction,
    leadFollowUpDate: data.leadFollowUpDate,
    leadAssignedToAgent: data.leadAssignedToAgent,

    requirementStatus: data.requirementStatus,
    requirementDistrict: data.requirementDistrict,
    requirementBedrooms: data.requirementBedrooms,
    requirementMinPrice: data.requirementMinPrice,
    requirementMaxPrice: data.requirementMaxPrice,
    requirementCondition: data.requirementCondition,
    requirementPropertyTypes: data.requirementPropertyTypes,
    requirementPropertyLocations: data.requirementPropertyLocations,
    requirementOtherDetails: data.requirementOtherDetails,

    matchingPropertiesToMatch: data.matchingPropertiesToMatch,
    matchingEmailMatchedProperties: data.matchingEmailMatchedProperties,
    matchingNotificationFrequency: data.matchingNotificationFrequency,
    matchingLastMatchDate: data.matchingLastMatchDate,

    propertiesInterested: data.propertiesInterested,
    propertiesInspected: data.propertiesInspected,
    propertiesEmailed: data.propertiesEmailed,
    propertiesMatched: data.propertiesMatched,

    propertyWonValue: data.propertyWonValue ? Math.round(data.propertyWonValue) : null,
    wonCommission: data.wonCommission ? Math.round(data.wonCommission) : null,
    propertyWonReference: data.propertyWonReference,
    propertyWonDate: data.propertyWonDate,
  };
}

// Handles Role Logic
async function handleContactRoles(tx: any, contactId: string, data: ValidatedContactData) {
  if (!data.roleType || !data.roleName) return;

  // Handle multi-property (entityIds - already parsed array) or single property (entityId)
  let propertyIds: string[] = [];
  if (data.entityIds && data.entityIds.length > 0) {
    propertyIds = data.entityIds;
  } else if (data.entityId) {
    propertyIds = [data.entityId];
  }

  if (data.roleType === 'property' && propertyIds.length > 0) {
    console.log('[handleContactRoles] Adding property roles', { propertyIds, roleName: data.roleName });
    for (const propertyId of propertyIds) {
      await tx.contactPropertyRole.upsert({
        where: {
          contactId_propertyId_role: {
            contactId: contactId,
            propertyId: propertyId,
            role: data.roleName,
          },
        },
        update: {},
        create: {
          contactId: contactId,
          propertyId: propertyId,
          role: data.roleName,
        },
      });
    }
  } else if (data.roleType === 'company' && data.entityId) {
    console.log('[handleContactRoles] Adding company role', { entityId: data.entityId, roleName: data.roleName });
    await tx.contactCompanyRole.upsert({
      where: {
        contactId_companyId_role: {
          contactId: contactId,
          companyId: data.entityId,
          role: data.roleName,
        },
      },
      update: {},
      create: {
        contactId: contactId,
        companyId: data.entityId,
        role: data.roleName,
      },
    });
  }
}

/**
 * Checks if a masked phone number potentially matches an existing number.
 * Returns true if we should flag a warning or error.
 */
async function checkPhoneDuplicate(locationId: string, phone: string | null | undefined, excludeContactId?: string) {
  if (!phone) return null;

  // exact match check first
  const exactMatch = await db.contact.findFirst({
    where: {
      locationId: locationId,
      phone: phone,
      NOT: excludeContactId ? { id: excludeContactId } : undefined
    }
  });

  if (exactMatch) return { type: 'Exact', contact: exactMatch };

  // If phone has asterisks, skip further checks for now or implement fuzzy logic
  if (phone.includes('*')) {
    // Implement fuzzy logic if needed. 
    // For now, masked numbers are treated as unique unless exact string match.
    // TODO: Advanced fuzzy matching
    return null;
  }

  return null;
}

// Logs history to the database
async function logContactHistory(tx: any, contactId: string, userId: string | null, action: string, changes: any = null) {
  try {
    await tx.contactHistory.create({
      data: {
        contactId,
        userId,
        action,
        changes: changes ? (typeof changes === 'string' ? changes : JSON.stringify(changes)) : null,
      }
    });
  } catch (e) {
    console.error('[logContactHistory] Failed to log history:', e);
  }
}


// --- Main Actions ---

export async function createContact(
  prevState: CreateContactState,
  formData: FormData
): Promise<CreateContactState> {
  const rawData: Record<string, any> = {};
  formData.forEach((value, key) => { rawData[key] = value; });
  console.log('[createContact] RAW FormData:', rawData);

  const validatedFields = createContactSchema.safeParse({
    name: formData.get('name') || undefined,
    email: formData.get('email') || '',
    phone: formData.get('phone') || undefined,
    message: formData.get('message') || undefined,
    locationId: formData.get('locationId') || undefined,
    contactType: formData.get('contactType') || undefined,
    roleType: formData.get('roleType') || undefined,
    entityId: formData.get('entityId') || undefined,
    roleName: formData.get('roleName') || undefined,
    entityIds: formData.get('entityIds') || undefined,

    leadGoal: formData.get('leadGoal') || undefined,
    leadPriority: formData.get('leadPriority') || undefined,
    leadStage: formData.get('leadStage') || undefined,
    leadSource: formData.get('leadSource') || undefined,
    leadNextAction: formData.get('leadNextAction') || undefined,
    leadFollowUpDate: formData.get('leadFollowUpDate') || undefined,
    leadAssignedToAgent: formData.get('leadAssignedToAgent') || undefined,

    requirementStatus: formData.get('requirementStatus') || undefined,
    requirementDistrict: formData.get('requirementDistrict') || undefined,
    requirementBedrooms: formData.get('requirementBedrooms') || undefined,
    requirementMinPrice: formData.get('requirementMinPrice') || undefined,
    requirementMaxPrice: formData.get('requirementMaxPrice') || undefined,
    requirementCondition: formData.get('requirementCondition') || undefined,
    requirementPropertyTypes: formData.get('requirementPropertyTypes') || undefined,
    requirementPropertyLocations: formData.get('requirementPropertyLocations') || undefined,
    requirementOtherDetails: formData.get('requirementOtherDetails') || undefined,

    matchingPropertiesToMatch: formData.get('matchingPropertiesToMatch') || undefined,
    matchingEmailMatchedProperties: formData.get('matchingEmailMatchedProperties') || undefined,
    matchingNotificationFrequency: formData.get('matchingNotificationFrequency') || undefined,
    matchingLastMatchDate: formData.get('matchingLastMatchDate') || undefined,

    propertiesInterested: formData.get('propertiesInterested') || undefined,
    propertiesInspected: formData.get('propertiesInspected') || undefined,
    propertiesEmailed: formData.get('propertiesEmailed') || undefined,
    propertiesMatched: formData.get('propertiesMatched') || undefined,

    propertyWonValue: formData.get('propertyWonValue') || undefined,
    wonCommission: formData.get('wonCommission') || undefined,
    propertyWonReference: formData.get('propertyWonReference') || undefined,
    propertyWonDate: formData.get('propertyWonDate') || undefined,
  });

  if (!validatedFields.success) {
    console.error('[createContact] Validation FAILED:', validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Contact.',
      success: false,
    };
  }

  const data = validatedFields.data;
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: 'Unauthorized' };
  }

  const hasAccess = await verifyUserHasAccessToLocation(userId, data.locationId);
  if (!hasAccess) {
    return { success: false, message: 'Unauthorized: You do not have access to this location.' };
  }

  // Resolve internal user ID for history logging
  const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;

  try {
    // Check for existing contact if email is provided
    if (data.email) {
      const existingContact = await db.contact.findFirst({
        where: { locationId: data.locationId, email: data.email },
      });
      if (existingContact) {
        return {
          errors: { email: ['A contact with this email already exists.'] },
          message: 'Contact already exists.',
          success: false,
        };
      }
    }

    // Transaction to create contact and role
    const contact = await db.$transaction(async (tx) => {
      const contactInput = prepareContactInput(data);
      const contact = await tx.contact.create({
        data: {
          ...contactInput,
          locationId: data.locationId,
          status: 'new', // Default status
        }
      });
      console.log('[createContact] Contact created', contact.id);

      await handleContactRoles(tx, contact.id, data);

      // Log Creation
      await logContactHistory(tx, contact.id, internalUserId, 'CREATED');

      return contact;
    });

    // Fetch location to get token and GHL Location ID
    const location = await db.location.findUnique({ where: { id: data.locationId }, select: { ghlAccessToken: true, ghlLocationId: true } });
    if (location?.ghlAccessToken && location?.ghlLocationId) {
      // Fire and forget or await? Usually await to catch errors, but don't block UI if non-critical.
      // We will try/catch and log error but not fail the action
      try {
        console.log('[createContact] Syncing to GHL...');
        // Create in GHL (Fire & Forget)
        syncContactToGHL(
          location.ghlLocationId,
          {
            name: contact.name || undefined,
            email: contact.email || undefined,
            phone: contact.phone || undefined
          },
          contact.ghlContactId
        ).then(async (ghlId) => {
          if (ghlId) {
            await db.contact.update({ where: { id: contact.id }, data: { ghlContactId: ghlId } });
          }
        }).catch(e => {
          console.error('[createContact] GHL Sync Failed (async):', e);
        });
      } catch (e) {
        console.error('[createContact] GHL Sync Failed (sync):', e);
      }
    }

    // Sync to Google Contacts if any user in this location has it enabled
    try {
      const googleUser = await db.user.findFirst({
        where: {
          locations: { some: { id: data.locationId } },
          googleSyncEnabled: true,
          googleRefreshToken: { not: null }
        },
        select: { id: true }
      });

      if (googleUser) {
        console.log('[createContact] Syncing to Google Contacts...');
        // Fire and forget - don't block the response
        syncContactToGoogle(googleUser.id, contact.id).catch(e =>
          console.error('[createContact] Google Sync Failed:', e)
        );
      }
    } catch (googleError) {
      console.error('[createContact] Google Sync check failed:', googleError);
    }


    revalidatePath('/admin/contacts');
    return {
      message: 'Contact created successfully.',
      success: true,
      contact: {
        id: contact.id,
        name: contact.name ?? '',
        email: contact.email,
        phone: contact.phone,
        message: contact.message || null
      },
    };

  } catch (error) {
    console.error('[createContact] Database Error:', error);
    return {
      message: 'Database Error: Failed to Create Contact.',
      success: false,
    };
  }
}


export async function updateContact(
  prevState: CreateContactState,
  formData: FormData
): Promise<CreateContactState> {
  const rawData: Record<string, any> = {};
  formData.forEach((value, key) => { rawData[key] = value; });
  console.log('[updateContact] RAW FormData:', rawData);

  const validatedFields = updateContactSchema.safeParse({
    contactId: formData.get('contactId'),
    name: formData.get('name') || undefined,
    email: formData.get('email') || '',
    phone: formData.get('phone') || undefined,
    message: formData.get('message') || undefined,
    locationId: formData.get('locationId') || undefined,
    contactType: formData.get('contactType') || undefined,
    roleType: formData.get('roleType') || undefined,
    entityId: formData.get('entityId') || undefined,
    entityIds: formData.get('entityIds') || undefined,
    roleName: formData.get('roleName') || undefined,

    leadGoal: formData.get('leadGoal') || undefined,
    leadPriority: formData.get('leadPriority') || undefined,
    leadStage: formData.get('leadStage') || undefined,
    leadSource: formData.get('leadSource') || undefined,
    leadNextAction: formData.get('leadNextAction') || undefined,
    leadFollowUpDate: formData.get('leadFollowUpDate') || undefined,
    leadAssignedToAgent: formData.get('leadAssignedToAgent') || undefined,

    requirementStatus: formData.get('requirementStatus') || undefined,
    requirementDistrict: formData.get('requirementDistrict') || undefined,
    requirementBedrooms: formData.get('requirementBedrooms') || undefined,
    requirementMinPrice: formData.get('requirementMinPrice') || undefined,
    requirementMaxPrice: formData.get('requirementMaxPrice') || undefined,
    requirementCondition: formData.get('requirementCondition') || undefined,
    requirementPropertyTypes: formData.get('requirementPropertyTypes') || undefined,
    requirementPropertyLocations: formData.get('requirementPropertyLocations') || undefined,
    requirementOtherDetails: formData.get('requirementOtherDetails') || undefined,

    matchingPropertiesToMatch: formData.get('matchingPropertiesToMatch') || undefined,
    matchingEmailMatchedProperties: formData.get('matchingEmailMatchedProperties') || undefined,
    matchingNotificationFrequency: formData.get('matchingNotificationFrequency') || undefined,
    matchingLastMatchDate: formData.get('matchingLastMatchDate') || undefined,

    propertiesInterested: formData.get('propertiesInterested') || undefined,
    propertiesInspected: formData.get('propertiesInspected') || undefined,
    propertiesEmailed: formData.get('propertiesEmailed') || undefined,
    propertiesMatched: formData.get('propertiesMatched') || undefined,

    propertyWonValue: formData.get('propertyWonValue') || undefined,
    wonCommission: formData.get('wonCommission') || undefined,
    propertyWonReference: formData.get('propertyWonReference') || undefined,
    propertyWonDate: formData.get('propertyWonDate') || undefined,
  });

  if (!validatedFields.success) {
    console.log('[updateContact] Validation failed', validatedFields.error.flatten().fieldErrors);
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Update Contact.',
      success: false,
    };
  }

  const data = validatedFields.data;
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: 'Unauthorized' };
  }

  const hasAccess = await verifyUserHasAccessToLocation(userId, data.locationId);
  if (!hasAccess) {
    return { success: false, message: 'Unauthorized: You do not have access to this location.' };
  }

  // Resolve internal user ID for history logging
  const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;

  // Also verify the contact actually belongs to this location
  const existingContactCheck = await db.contact.findUnique({
    where: { id: data.contactId },
    select: { locationId: true }
  });

  if (!existingContactCheck || existingContactCheck.locationId !== data.locationId) {
    return { success: false, message: 'Contact not found or access denied.' };
  }

  try {
    // Check for existing contact with same email (excluding current contact)
    if (data.email) {
      const existingContact = await db.contact.findFirst({
        where: {
          locationId: data.locationId,
          email: data.email,
          NOT: { id: data.contactId }
        },
      });

      if (existingContact) {
        return {
          errors: { email: ['A contact with this email already exists.'] },
          message: 'Contact with this email already exists.',
          success: false,
        };
      }
    }

    await db.$transaction(async (tx) => {
      // Fetch current state for diffing
      const currentContact = await tx.contact.findUnique({ where: { id: data.contactId } });

      const contactInput = prepareContactInput(data);
      const updatedContact = await tx.contact.update({
        where: { id: data.contactId },
        data: contactInput,
      });
      console.log('[updateContact] Contact updated successfully', data.contactId);

      // Calculate Changes
      const changes: { field: string; old: any; new: any }[] = [];
      if (currentContact) {
        // Compare fields in contactInput with currentContact
        for (const key in contactInput) {
          const k = key as keyof typeof contactInput;
          const newVal = contactInput[k];
          const oldVal = currentContact[k as keyof typeof currentContact];

          // Enhanced equality check to skip noise (null vs undefined vs "")
          if (!areValuesEqual(newVal, oldVal)) {
            // Skip untracked or noisy fields if necessary
            if (key === 'updatedAt') continue;
            changes.push({ field: key, old: normalizeForDiff(oldVal), new: normalizeForDiff(newVal) });
          }
        }
      }

      if (changes.length > 0) {
        // Resolve IDs to human readable values (Properties, Users)
        await enrichChangesWithReadableValues(changes);
        await logContactHistory(tx, data.contactId, internalUserId, 'UPDATED', changes);
      }

      await handleContactRoles(tx, data.contactId, data);
    });

    // 3-Way Sync: Estio -> GHL + Google Contacts

    // 1. Sync to GoHighLevel
    try {
      const location = await db.location.findUnique({
        where: { id: data.locationId },
        select: { ghlAccessToken: true, ghlLocationId: true }
      });

      if (location?.ghlAccessToken && location?.ghlLocationId) {
        console.log('[updateContact] Syncing to GoHighLevel...');
        const ghlId = await syncContactToGHL(location.ghlLocationId, {
          name: data.name || undefined,
          email: data.email || undefined,
          phone: data.phone || undefined,
        });
        // Update ghlContactId if it was newly created
        if (ghlId) {
          const existingContact = await db.contact.findUnique({
            where: { id: data.contactId },
            select: { ghlContactId: true }
          });
          if (!existingContact?.ghlContactId) {
            await db.contact.update({
              where: { id: data.contactId },
              data: { ghlContactId: ghlId }
            });
          }
        }
        console.log('[updateContact] GHL Sync complete');
      }
    } catch (ghlError) {
      console.error('[updateContact] GHL Sync Failed:', ghlError);
    }

    // 2. Sync to Google Contacts
    try {
      const googleUser = await db.user.findFirst({
        where: {
          locations: { some: { id: data.locationId } },
          googleSyncEnabled: true,
          googleRefreshToken: { not: null }
        },
        select: { id: true }
      });

      if (googleUser) {
        console.log('[updateContact] Syncing to Google Contacts...');
        // Fire and forget - don't block the response
        syncContactToGoogle(googleUser.id, data.contactId).catch(e =>
          console.error('[updateContact] Google Sync Failed:', e)
        );
      }
    } catch (googleError) {
      console.error('[updateContact] Google Sync check failed:', googleError);
    }

  } catch (error) {
    console.error('[updateContact] Database Error:', error);
    return {
      message: 'Database Error: Failed to Update Contact.',
      success: false,
    };
  }

  // revalidatePath('/admin/contacts');
  return {
    message: 'Contact updated successfully.',
    success: true,
    contact: {
      id: data.contactId,
      name: data.name,
      email: data.email || null,
      phone: data.phone || null,
      message: data.message || null
    }
  };
}


export async function deleteContactRole(roleId: string, type: 'property' | 'company') {
  const { userId } = await auth();
  if (!userId) {
    return { success: false, message: 'Unauthorized' };
  }

  try {
    let contactId: string | undefined;

    if (type === 'property') {
      const role = await db.contactPropertyRole.findUnique({
        where: { id: roleId },
        select: { contactId: true }
      });
      contactId = role?.contactId;
    } else {
      const role = await db.contactCompanyRole.findUnique({
        where: { id: roleId },
        select: { contactId: true }
      });
      contactId = role?.contactId;
    }

    if (!contactId) return { success: false, message: 'Role not found.' };

    const contact = await db.contact.findUnique({
      where: { id: contactId },
      select: { locationId: true }
    });

    if (!contact) return { success: false, message: 'Contact not found.' };

    const hasAccess = await verifyUserHasAccessToLocation(userId, contact.locationId);
    if (!hasAccess) return { success: false, message: 'Unauthorized' };

    if (type === 'property') {
      await db.contactPropertyRole.delete({ where: { id: roleId } });
    } else {
      await db.contactCompanyRole.delete({ where: { id: roleId } });
    }
    revalidatePath('/admin/contacts');
    return { success: true, message: 'Role deleted successfully.' };
  } catch (error) {
    console.error('Failed to delete role:', error);
    return { success: false, message: 'Failed to delete role.' };
  }
}

const createCompanySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().optional(),
  locationId: z.string().min(1, 'Location ID is required'),
  type: z.string().optional(),
});

// --- Conflict Resolution Actions ---

export async function searchGoogleContactsAction(query: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  // Get user with google token
  const user = await db.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, googleSyncEnabled: true }
  });

  if (!user || !user.googleSyncEnabled) return { success: false, message: 'Google Sync not enabled' };

  const { searchGoogleContacts } = await import('@/lib/google/people');
  const results = await searchGoogleContacts(user.id, query);
  return { success: true, data: results };
}

export async function resolveSyncConflict(
  contactId: string,
  resolution: 'use_google' | 'use_local' | 'link_only',
  googleData?: {
    resourceName: string,
    name?: string | null,
    email?: string | null,
    phone?: string | null,
    etag?: string,
    updateTime?: Date
  }
) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    // Get internal user ID
    const user = await db.user.findUnique({ where: { clerkId: userId } });
    if (!user) return { success: false, message: 'User not found' };

    const contact = await db.contact.findUnique({ where: { id: contactId } });
    if (!contact) return { success: false, message: 'Contact not found' };

    // 1. USE GOOGLE (Overwrite Local)
    if (resolution === 'use_google' && googleData?.resourceName) {
      console.log(`[Resolve Conflict] Overwriting Local Contact ${contactId} with Google Data`);

      await db.contact.update({
        where: { id: contactId },
        data: {
          name: googleData.name || contact.name,
          email: googleData.email || contact.email,
          phone: googleData.phone || contact.phone,
          googleContactId: googleData.resourceName,
          googleContactUpdatedAt: googleData.updateTime,
          lastGoogleSync: new Date(),
          error: null // Clear Error
        }
      });

      revalidatePath('/admin/contacts');
      return { success: true, message: 'Resolved: Updated local contact from Google.' };
    }

    // 2. USE LOCAL (Overwrite Google - Force Push)
    if (resolution === 'use_local') {
      console.log(`[Resolve Conflict] Overwriting Google Contact with Local Data`);

      // If we have a target Google ID (e.g. selected from search), link it first
      if (googleData?.resourceName) {
        await db.contact.update({
          where: { id: contactId },
          data: { googleContactId: googleData.resourceName, error: null }
        });
      } else {
        // No Google ID provided? Then we are creating NEW or re-using existing if failed?
        // If existing was 404, we cleared it. So this is effectively "Create New".
        await db.contact.update({
          where: { id: contactId },
          data: { error: null }
        });
      }

      // Trigger Sync
      const { syncContactToGoogle } = await import('@/lib/google/people');
      // We don't await this to keep UI snappy? No, for resolution we should await to ensure success
      await syncContactToGoogle(user.id, contactId);

      revalidatePath('/admin/contacts');
      return { success: true, message: 'Resolved: Pushing local changes to Google.' };
    }

    // 3. LINK ONLY
    if (resolution === 'link_only' && googleData?.resourceName) {
      console.log(`[Resolve Conflict] Relinking only.`);
      await db.contact.update({
        where: { id: contactId },
        data: {
          googleContactId: googleData.resourceName,
          googleContactUpdatedAt: googleData.updateTime,
          lastGoogleSync: new Date(),
          error: null
        }
      });
      revalidatePath('/admin/contacts');
      return { success: true, message: 'Resolved: Link restored.' };
    }

    return { success: false, message: 'Invalid resolution parameters.' };

  } catch (error: any) {
    console.error('[resolveSyncConflict] Error:', error);
    return { success: false, message: 'Failed to resolve conflict: ' + error.message };
  }
}

export type CreateCompanyState = {
  errors?: Record<string, string[] | undefined>;
  message?: string;
  success?: boolean;
  company?: { id: string; name: string };
};

export async function createCompany(
  prevState: CreateCompanyState,
  formData: FormData
): Promise<CreateCompanyState> {
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
  if (!userId) return { success: false, message: 'Unauthorized' };

  const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
  if (!hasAccess) return { success: false, message: 'Unauthorized: You do not have access to this location.' };

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

    revalidatePath('/admin/contacts');
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

// Viewings

const viewingSchema = z.object({
  contactId: z.string().min(1, 'Contact ID is required'),
  propertyId: z.string().min(1, 'Property ID is required'),
  userId: z.string().min(1, 'Agent/User ID is required'),
  date: z.string().min(1, 'Date is required'),
  notes: z.string().optional(),
});

import { createAppointment } from '@/lib/ghl/calendars';

export async function createViewing(
  prevState: any,
  formData: FormData
) {
  const validatedFields = viewingSchema.safeParse({
    contactId: formData.get('contactId'),
    propertyId: formData.get('propertyId'),
    userId: formData.get('userId'),
    date: formData.get('date'),
    notes: formData.get('notes'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Viewing.',
      success: false,
    };
  }

  const data = validatedFields.data;
  const { userId: currentUserId } = await auth();
  if (!currentUserId) return { success: false, message: 'Unauthorized' };

  // Resolve internal user ID for history logging
  const dbUser = await db.user.findUnique({ where: { clerkId: currentUserId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;

  try {
    const agent = await db.user.findUnique({
      where: { id: data.userId },
      select: { ghlCalendarId: true }
    });

    const contact = await db.contact.findUnique({
      where: { id: data.contactId },
      include: { location: true }
    });

    if (!contact) return { success: false, message: 'Contact not found.' };

    let ghlAppointmentId: string | undefined;

    if (agent?.ghlCalendarId && contact.location.ghlAccessToken && contact.location.ghlLocationId) {
      try {
        let ghlContactId = contact.ghlContactId;

        // Ensure GHL Contact Exists
        if (!ghlContactId) {
          console.log('[createViewing] Syncing contact to GHL before appointment...');
          ghlContactId = await syncContactToGHL(contact.location.ghlLocationId, {
            name: contact.name || undefined,
            email: contact.email || undefined,
            phone: contact.phone || undefined,
          });

          if (ghlContactId) {
            await db.contact.update({ where: { id: contact.id }, data: { ghlContactId } });
          }
        }

        if (ghlContactId) {
          const appointmentResponse = await createAppointment({
            calendarId: agent.ghlCalendarId,
            locationId: contact.locationId,
            contactId: ghlContactId,
            startTime: new Date(data.date).toISOString(),
            title: `Viewing: ${data.propertyId}`,
            appointmentStatus: "confirmed",
            toNotify: true
          });

          if (appointmentResponse?.id) {
            ghlAppointmentId = appointmentResponse.id;
          }
        }
      } catch (ghlError) {
        console.error('[createViewing] GHL Sync Failed (proceeding locally):', ghlError);
      }
    }

    await db.viewing.create({
      data: {
        contactId: data.contactId,
        propertyId: data.propertyId,
        userId: data.userId,
        date: new Date(data.date),
        notes: data.notes,
        ghlAppointmentId,
        status: 'scheduled',
      }
    });

    // Fetch property reference for logging
    const propertyForLog = await db.property.findUnique({ where: { id: data.propertyId }, select: { reference: true, title: true } });
    const propertyRef = propertyForLog?.reference || propertyForLog?.title || 'Unknown Property';

    // Log Viewing Added
    await logContactHistory(db, data.contactId, internalUserId, 'VIEWING_ADDED', { property: propertyRef, date: data.date, notes: data.notes });

    revalidatePath(`/admin/properties/${data.propertyId}`);
    return { success: true, message: 'Viewing scheduled successfully!' };
  } catch (error) {
    console.error('Failed to create viewing:', error);
    return { success: false, message: 'Failed to create viewing.' };
  }
}

export async function updateViewing(
  prevState: any,
  formData: FormData
) {
  const viewingId = formData.get('viewingId') as string;
  const validatedFields = viewingSchema.safeParse({
    contactId: formData.get('contactId'),
    propertyId: formData.get('propertyId'),
    userId: formData.get('userId'),
    date: formData.get('date'),
    notes: formData.get('notes'),
  });

  if (!validatedFields.success || !viewingId) {
    return {
      errors: validatedFields.error?.flatten().fieldErrors,
      message: 'Missing Fields or ID. Failed to Update Viewing.',
      success: false,
    };
  }

  const { userId: currentUserId } = await auth();
  if (!currentUserId) return { success: false, message: 'Unauthorized' };

  // Resolve internal user ID for history logging
  const dbUser = await db.user.findUnique({ where: { clerkId: currentUserId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;

  try {
    await db.viewing.update({
      where: { id: viewingId },
      data: {
        date: new Date(validatedFields.data.date),
        notes: validatedFields.data.notes,
        userId: validatedFields.data.userId,
        propertyId: validatedFields.data.propertyId,
      }
    });

    // Log Viewing Updated
    // We need contactId here, but it's in formData as optional/string. The schema validates it.
    // However, the updateViewing function doesn't seem to have contactId easily available from the update result?
    // The schema validation allows extracting it.
    const contactId = validatedFields.data.contactId;
    if (contactId) {
      const propertyForLog = await db.property.findUnique({ where: { id: validatedFields.data.propertyId }, select: { reference: true, title: true } });
      const propertyRef = propertyForLog?.reference || propertyForLog?.title || 'Unknown Property';

      await logContactHistory(db, contactId, internalUserId, 'VIEWING_UPDATED', { property: propertyRef, date: validatedFields.data.date, notes: validatedFields.data.notes });
    }

    return { success: true, message: 'Viewing updated successfully.' };
  } catch (e) {
    console.error(e);
    return { success: false, message: 'Failed to update viewing.' };
  }
}

export async function deleteViewing(viewingId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    await db.viewing.delete({ where: { id: viewingId } });
    return { success: true, message: 'Viewing deleted.' };
  } catch (e) {
    return { success: false, message: 'Failed to delete viewing.' };
  }
}

export async function checkPropertyOwnerEmail(propertyId: string) {
  try {
    const ownerRole = await db.contactPropertyRole.findFirst({
      where: {
        propertyId: propertyId,
        role: 'owner', // using lower-case per contact stats
        contact: {
          email: {
            not: null
          }
        }
      },
      include: {
        contact: {
          select: { email: true }
        }
      }
    });

    // Also check "Owner" title case just in case of data inconsistencies
    const ownerRoleTitle = !ownerRole ? await db.contactPropertyRole.findFirst({
      where: {
        propertyId: propertyId,
        role: 'Owner',
        contact: { email: { not: null } }
      }
    }) : null;

    const hasEmail = !!ownerRole || !!ownerRoleTitle;
    return { hasEmail };
  } catch (e) {
    console.error(e);
    return { hasEmail: false };
  }
}

export async function deleteContact(contactId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    const contact = await db.contact.findUnique({ where: { id: contactId }, select: { locationId: true } });
    if (!contact) return { success: false, message: 'Contact not found' };

    const hasAccess = await verifyUserHasAccessToLocation(userId, contact.locationId);
    if (!hasAccess) return { success: false, message: 'Unauthorized' };

    await db.$transaction(async (tx) => {
      // Delete Roles
      await tx.contactPropertyRole.deleteMany({ where: { contactId } });
      await tx.contactCompanyRole.deleteMany({ where: { contactId } });

      // Delete Viewings
      await tx.viewing.deleteMany({ where: { contactId } });

      // Delete Swipes
      await tx.propertySwipe.deleteMany({ where: { contactId } });

      // Unlink Sessions
      await tx.swipeSession.updateMany({
        where: { contactId },
        data: { contactId: null }
      });

      // Delete Contact
      await tx.contact.delete({ where: { id: contactId } });
    });

    revalidatePath('/admin/contacts');
    return { success: true, message: 'Contact deleted successfully.' };
  } catch (e) {
    console.error('Delete Contact Error:', e);
    return { success: false, message: 'Failed to delete contact.' };
  }
}

export async function addContactHistoryEntry(contactId: string, entry: string, date: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    if (!dbUser) return { success: false, message: 'User not found' };

    await logContactHistory(db, contactId, dbUser.id, 'MANUAL_ENTRY', { entry, date });

    revalidatePath('/admin/contacts');
    return { success: true, message: 'Entry added to history.' };
  } catch (error) {
    console.error('Failed to add history entry:', error);
    return { success: false, message: 'Failed to add entry.' };
  }
}

export async function getContactDetails(contactId: string) {
  const { userId } = await auth();
  if (!userId) return null;

  const contact = await db.contact.findUnique({
    where: { id: contactId },
    include: {
      propertyRoles: {
        include: {
          property: { select: { id: true, title: true, reference: true } }
        }
      },
      companyRoles: {
        include: {
          company: { select: { id: true, name: true } }
        }
      },
      viewings: {
        include: {
          property: { select: { id: true, title: true, reference: true, unitNumber: true } },
          user: { select: { id: true, name: true } }
        },
        orderBy: { date: 'desc' }
      }
    }
  });

  if (!contact) return null;

  const hasAccess = await verifyUserHasAccessToLocation(userId, contact.locationId);
  if (!hasAccess) return null;

  const leadSources = await db.leadSource.findMany({
    where: { locationId: contact.locationId, isActive: true },
    select: { name: true },
    orderBy: { name: 'asc' }
  });

  // Collect Property IDs for mapping names
  const propertyIds = new Set<string>();
  contact.propertiesInterested?.forEach(id => propertyIds.add(id));
  contact.propertiesInspected?.forEach(id => propertyIds.add(id));
  contact.propertiesEmailed?.forEach(id => propertyIds.add(id));
  contact.propertiesMatched?.forEach(id => propertyIds.add(id));

  let propertyMap: Record<string, string> = {};
  if (propertyIds.size > 0) {
    const properties = await db.property.findMany({
      where: { id: { in: Array.from(propertyIds) } },
      select: { id: true, title: true, reference: true, unitNumber: true }
    });
    properties.forEach(p => {
      propertyMap[p.id] = p.unitNumber ? `[${p.unitNumber}] ${p.title}` : (p.reference || p.title);
    });
  }

  // Collect User IDs (Agent)
  const userIds = new Set<string>();
  if (contact.leadAssignedToAgent) userIds.add(contact.leadAssignedToAgent);

  let userMap: Record<string, string> = {};
  if (userIds.size > 0) {
    const users = await db.user.findMany({
      where: { id: { in: Array.from(userIds) } },
      select: { id: true, name: true, email: true }
    });
    users.forEach(u => {
      userMap[u.id] = u.name || u.email;
    });
  }

  return {
    contact: {
      ...contact,
      viewings: contact.viewings.map(v => ({
        ...v,
        date: v.date.toISOString(),
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      }))
    },
    propertyMap,
    userMap,
    leadSources: leadSources.map(s => s.name)
  };
}



export async function unlinkGoogleContact(contactId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    await db.contact.update({
      where: { id: contactId },
      data: {
        googleContactId: null,
        googleContactUpdatedAt: null,
        error: null
      }
    });
    revalidatePath('/admin/contacts');
    return { success: true, message: 'Contact unlinked from Google.' };
  } catch (error: any) {
    return { success: false, message: 'Failed to unlink: ' + error.message };
  }
}
