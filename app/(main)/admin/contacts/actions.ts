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
import { runGoogleAutoSyncForContact } from '@/lib/google/automation';
import { getLocationContext } from '@/lib/auth/location-context';
import { parseEvolutionMessageContent } from '@/lib/whatsapp/evolution-media';
import { seedConversationFromContactLeadText } from '@/lib/conversations/bootstrap';

async function resolvePreferredChannelTypeForPhone(
  location: { evolutionInstanceId?: string | null },
  phone: string | null | undefined
): Promise<'TYPE_WHATSAPP' | 'TYPE_SMS'> {
  const rawDigits = String(phone || '').replace(/\D/g, '');
  if (!location?.evolutionInstanceId || rawDigits.length < 7) {
    return 'TYPE_SMS';
  }

  try {
    const { evolutionClient } = await import('@/lib/evolution/client');
    const lookup = await evolutionClient.checkWhatsAppNumber(location.evolutionInstanceId, rawDigits);
    if (lookup.exists) return 'TYPE_WHATSAPP';
  } catch (err) {
    console.warn('[Contacts] WhatsApp lookup failed:', err);
  }

  return 'TYPE_SMS';
}

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
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().regex(/^[\w\-\.\+=]+@[\w\-\.]+\.[a-zA-Z]{2,}$/, 'Invalid email address').optional().or(z.literal('')),
  phone: z.string().optional().transform(normalizePhone),
  locationId: z.string().min(1, 'Location ID is required'),
  message: z.string().optional(),
  contactType: z.enum(CONTACT_TYPES).optional().default('Lead'),

  // Enhanced Demographics
  dateOfBirth: z.string().optional().transform(parseDate),
  tags: z.string().optional().transform(parseArray),

  // Address
  address1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),

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
  leadOtherDetails: z.string().optional(),

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
  duplicateContact?: { id: string; name: string | null; email?: string | null; phone?: string | null };
};

function buildDuplicatePhoneState(
  contact: { id: string; name: string | null; email?: string | null; phone?: string | null }
): CreateContactState {
  return {
    errors: { phone: ['A contact with this phone already exists.'] },
    message: 'Phone already exists. Open the existing contact instead.',
    success: false,
    duplicateContact: {
      id: contact.id,
      name: contact.name,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
    },
  };
}

export async function openOrStartConversationForContact(contactId: string) {
  try {
    const location = await getLocationContext();
    if (!location?.id) {
      return { success: false, error: 'Unauthorized' };
    }

    const { userId } = await auth();
    if (!userId) {
      return { success: false, error: 'Unauthorized' };
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, location.id);
    if (!hasAccess) {
      return { success: false, error: 'Unauthorized' };
    }

    const contact = await db.contact.findFirst({
      where: { id: contactId, locationId: location.id },
      select: { id: true, phone: true, name: true, message: true }
    });

    if (!contact) {
      return { success: false, error: 'Contact not found' };
    }

    const existingConversation = await db.conversation.findFirst({
      where: { locationId: location.id, contactId: contact.id },
      select: { id: true, ghlConversationId: true, lastMessageType: true, createdAt: true }
    });

    if (existingConversation) {
      const seedResult = await seedConversationFromContactLeadText({
        conversationId: existingConversation.id,
        contact,
        messageType: existingConversation.lastMessageType || 'TYPE_SMS',
        messageDate: existingConversation.createdAt,
        source: 'contact_bootstrap'
      });
      if (seedResult.seeded) {
        console.log(`[Contacts] Seeded existing conversation ${existingConversation.ghlConversationId} from contact.message`);
      }

      return {
        success: true,
        conversationId: existingConversation.ghlConversationId,
        isNew: false
      };
    }

    if (!contact.phone) {
      return { success: false, error: 'Contact has no phone number' };
    }

    const preferredChannelType = await resolvePreferredChannelTypeForPhone(location, contact.phone);

    const conversation = await db.conversation.create({
      data: {
        ghlConversationId: `wa_${Date.now()}_${contact.id}`,
        locationId: location.id,
        contactId: contact.id,
        lastMessageBody: null,
        lastMessageAt: new Date(0),
        lastMessageType: preferredChannelType,
        unreadCount: 0,
        status: 'open'
      },
      select: { id: true, ghlConversationId: true, lastMessageType: true, createdAt: true }
    });

    let messagesImported = 0;
    if (location.evolutionInstanceId && contact.phone) {
      try {
        const { evolutionClient } = await import('@/lib/evolution/client');
        const { processNormalizedMessage } = await import('@/lib/whatsapp/sync');

        const rawDigits = contact.phone.replace(/\D/g, '');
        if (rawDigits.length >= 7) {
          const remoteJid = `${rawDigits}@s.whatsapp.net`;
          const messages = await evolutionClient.fetchMessages(location.evolutionInstanceId, remoteJid, 30);

          for (const msg of (messages || [])) {
            const key = msg.key;
            const messageContent = msg.message;
            if (!messageContent || !key?.id) continue;

            const isFromMe = key.fromMe;
            const parsedContent = parseEvolutionMessageContent(messageContent);
            const normalized: any = {
              from: isFromMe ? location.id : rawDigits,
              to: isFromMe ? rawDigits : location.id,
              body: parsedContent.body,
              type: parsedContent.type,
              wamId: key.id,
              timestamp: new Date(msg.messageTimestamp ? (msg.messageTimestamp as number) * 1000 : Date.now()),
              direction: isFromMe ? 'outbound' : 'inbound',
              source: 'whatsapp_evolution',
              locationId: location.id,
              contactName: isFromMe ? undefined : msg.pushName
            };

            const result = await processNormalizedMessage(normalized);
            if (result?.status === 'processed') messagesImported++;
          }
        }
      } catch (backfillError) {
        console.warn('[Contacts] Conversation backfill failed:', backfillError);
      }
    }

    const seedResult = await seedConversationFromContactLeadText({
      conversationId: conversation.id,
      contact,
      messageType: conversation.lastMessageType || preferredChannelType,
      messageDate: conversation.createdAt,
      source: 'contact_bootstrap'
    });
    if (seedResult.seeded) {
      console.log(`[Contacts] Seeded new conversation ${conversation.ghlConversationId} from contact.message`);
    }

    return {
      success: true,
      conversationId: conversation.ghlConversationId,
      isNew: true,
      messagesImported
    };
  } catch (error: any) {
    // Prisma unique collision is possible on concurrent clicks; return the existing conversation.
    if (String(error?.code) === 'P2002') {
      const location = await getLocationContext();
      if (location?.id) {
        const existingConversation = await db.conversation.findFirst({
          where: { locationId: location.id, contactId },
          select: { ghlConversationId: true }
        });
        if (existingConversation) {
          return { success: true, conversationId: existingConversation.ghlConversationId, isNew: false };
        }
      }
    }
    return { success: false, error: error?.message || 'Failed to open conversation' };
  }
}

// --- Logic Helpers ---

// Prepares the Prisma data object from validated Zod data
function prepareContactInput(data: ValidatedContactData) {
  return {
    name: data.name,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email || null,
    phone: data.phone || null,
    message: data.message,
    contactType: data.contactType,

    dateOfBirth: data.dateOfBirth,
    tags: data.tags,
    address1: data.address1,
    city: data.city,
    state: data.state,
    postalCode: data.postalCode,
    country: data.country,

    leadGoal: data.leadGoal,
    leadPriority: data.leadPriority,
    leadStage: data.leadStage,
    leadSource: data.leadSource,
    leadNextAction: data.leadNextAction,
    leadFollowUpDate: data.leadFollowUpDate,
    leadAssignedToAgent: data.leadAssignedToAgent,
    notes: data.leadOtherDetails ?? undefined,

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
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
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
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined,
    email: formData.get('email') || '',
    phone: formData.get('phone') || undefined,
    message: formData.get('message') || undefined,
    locationId: formData.get('locationId') || undefined,
    contactType: formData.get('contactType') || undefined,
    roleType: formData.get('roleType') || undefined,
    entityId: formData.get('entityId') || undefined,
    roleName: formData.get('roleName') || undefined,
    entityIds: formData.get('entityIds') || undefined,

    dateOfBirth: formData.get('dateOfBirth') || undefined,
    tags: formData.get('tags') || undefined,
    address1: formData.get('address1') || undefined,
    city: formData.get('city') || undefined,
    state: formData.get('state') || undefined,
    postalCode: formData.get('postalCode') || undefined,
    country: formData.get('country') || undefined,

    leadGoal: formData.get('leadGoal') || undefined,
    leadPriority: formData.get('leadPriority') || undefined,
    leadStage: formData.get('leadStage') || undefined,
    leadSource: formData.get('leadSource') || undefined,
    leadNextAction: formData.get('leadNextAction') || undefined,
    leadFollowUpDate: formData.get('leadFollowUpDate') || undefined,
    leadAssignedToAgent: formData.get('leadAssignedToAgent') || undefined,
    leadOtherDetails: formData.get('leadOtherDetails') as string || undefined,

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

    // Check for existing contact if phone is provided
    if (data.phone) {
      const phoneDuplicate = await checkPhoneDuplicate(data.locationId, data.phone);
      if (phoneDuplicate?.type === 'Exact') {
        return buildDuplicatePhoneState(phoneDuplicate.contact);
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

    // Optional Google auto-sync (opt-in settings)
    await runGoogleAutoSyncForContact({
      locationId: data.locationId,
      contactId: contact.id,
      source: 'CONTACT_FORM',
      event: 'create',
      preferredUserId: internalUserId
    });


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

  } catch (error: any) {
    if (String(error?.code) === 'P2002') {
      const targets = Array.isArray(error?.meta?.target) ? error.meta.target.map(String) : [];

      if (targets.includes('phone') && data.phone) {
        const phoneDuplicate = await checkPhoneDuplicate(data.locationId, data.phone);
        if (phoneDuplicate?.type === 'Exact') {
          return buildDuplicatePhoneState(phoneDuplicate.contact);
        }
      }
    }

    console.error('[createContact] Database Error:', error);
    return {
      message: 'Database Error: Failed to Create Contact.',
      success: false,
    };
  }
}

async function updateContactCore(
  data: ValidatedContactData & { contactId: string },
  userId: string
): Promise<CreateContactState> {
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

    // Check for existing contact with same phone (excluding current contact)
    if (data.phone) {
      const phoneDuplicate = await checkPhoneDuplicate(data.locationId, data.phone, data.contactId);
      if (phoneDuplicate?.type === 'Exact') {
        return buildDuplicatePhoneState(phoneDuplicate.contact);
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

    // 2. Optional Google auto-sync for linked contacts (opt-in settings)
    await runGoogleAutoSyncForContact({
      locationId: data.locationId,
      contactId: data.contactId,
      source: 'CONTACT_FORM',
      event: 'update',
      preferredUserId: internalUserId
    });

    return { success: true, message: 'Contact updated successfully.' };

  } catch (error: any) {
    if (String(error?.code) === 'P2002') {
      const targets = Array.isArray(error?.meta?.target) ? error.meta.target.map(String) : [];

      if (targets.includes('phone') && data.phone) {
        const phoneDuplicate = await checkPhoneDuplicate(data.locationId, data.phone, data.contactId);
        if (phoneDuplicate?.type === 'Exact') {
          return buildDuplicatePhoneState(phoneDuplicate.contact);
        }
      }
    }

    console.error('[updateContact] Database Error:', error);
    return {
      message: error.message || 'Database Error: Failed to Update Contact.',
      success: false,
    };
  }
}

export async function updateContactAction(contactId: string, data: Partial<ValidatedContactData>) {
  const { userId } = await auth();
  if (!userId) return { success: false, error: "Unauthorized" };

  // We already have clean data from the UI (mostly), but we need to ensure it fits ValidatedContactData
  // We can fetch the existing contact to fill in missing required fields if needed, 
  // but for partial updates, we might want a partial schema.
  // However, updateContactCore requires ValidatedContactData.

  // Fetch existing validation requirements (locationId is required for core logic)
  const existing = await db.contact.findUnique({
    where: { id: contactId },
    select: { locationId: true, name: true }
  });

  if (!existing) return { success: false, error: "Contact not found" };

  // Construct full data object
  const fullData: any = {
    contactId,
    locationId: existing.locationId,
    name: existing.name, // Fallback
    ...data
  };

  const res = await updateContactCore(fullData, userId);
  revalidatePath('/admin/contacts');
  return res.success ? { success: true } : { success: false, error: res.message };
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
    firstName: formData.get('firstName') || undefined,
    lastName: formData.get('lastName') || undefined,
    email: formData.get('email') || '',
    phone: formData.get('phone') || undefined,
    message: formData.get('message') || undefined,
    locationId: formData.get('locationId') || undefined,
    contactType: formData.get('contactType') || undefined,
    roleType: formData.get('roleType') || undefined,
    entityId: formData.get('entityId') || undefined,
    entityIds: formData.get('entityIds') || undefined,
    roleName: formData.get('roleName') || undefined,

    dateOfBirth: formData.get('dateOfBirth') || undefined,
    tags: formData.get('tags') || undefined,
    address1: formData.get('address1') || undefined,
    city: formData.get('city') || undefined,
    state: formData.get('state') || undefined,
    postalCode: formData.get('postalCode') || undefined,
    country: formData.get('country') || undefined,

    leadGoal: formData.get('leadGoal') || undefined,
    leadPriority: formData.get('leadPriority') || undefined,
    leadStage: formData.get('leadStage') || undefined,
    leadSource: formData.get('leadSource') || undefined,
    leadNextAction: formData.get('leadNextAction') || undefined,
    leadFollowUpDate: formData.get('leadFollowUpDate') || undefined,
    leadAssignedToAgent: formData.get('leadAssignedToAgent') || undefined,
    leadOtherDetails: formData.get('leadOtherDetails') as string || undefined,

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

  const result = await updateContactCore(data, userId);

  return {
    message: result.message || (result.success ? 'Contact updated successfully.' : 'Update failed'),
    success: result.success,
    errors: result.errors,
    duplicateContact: result.duplicateContact,
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



export async function getGoogleContactAction(resourceName: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    // Check current user's Google connection
    const user = await db.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, googleSyncEnabled: true, googleRefreshToken: true }
    });

    if (!user?.googleSyncEnabled || !user?.googleRefreshToken) {
      return { success: false, message: 'GOOGLE_NOT_CONNECTED' };
    }

    const { getGoogleContact } = await import('@/lib/google/people');
    const result = await getGoogleContact(user.id, resourceName);

    if (!result) return { success: false, message: 'Contact not found in Google' };
    return { success: true, data: result };
  } catch (error: any) {
    if (error.message === 'GOOGLE_AUTH_EXPIRED') {
      return { success: false, message: 'GOOGLE_AUTH_EXPIRED' };
    }
    console.error('[getGoogleContactAction] Error:', error);
    return { success: false, message: 'Failed to fetch contact' };
  }
}

export async function searchGoogleContactsAction(query: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    // Check current user's Google connection
    const user = await db.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, googleSyncEnabled: true, googleRefreshToken: true }
    });

    if (!user?.googleSyncEnabled || !user?.googleRefreshToken) {
      return { success: false, message: 'GOOGLE_NOT_CONNECTED' };
    }

    const { searchGoogleContacts } = await import('@/lib/google/people');
    const results = await searchGoogleContacts(user.id, query);
    return { success: true, data: results };
  } catch (error: any) {
    if (error.message === 'GOOGLE_AUTH_EXPIRED') {
      return { success: false, message: 'GOOGLE_AUTH_EXPIRED' };
    }
    console.error('[searchGoogleContactsAction] Error:', error);
    return { success: false, message: 'Failed to search contacts' };
  }
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
  },
  options?: {
    skipRevalidate?: boolean;
  }
) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    const getContactPatch = async () => db.contact.findUnique({
      where: { id: contactId },
      select: {
        name: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        address1: true,
        city: true,
        state: true,
        postalCode: true,
        country: true,
        googleContactId: true,
        lastGoogleSync: true,
        googleContactUpdatedAt: true,
        error: true,
      }
    });

    // Get internal user ID and check Google connection
    const user = await db.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, googleSyncEnabled: true, googleRefreshToken: true }
    });
    if (!user) return { success: false, message: 'User not found' };

    if (!user.googleSyncEnabled || !user.googleRefreshToken) {
      return { success: false, message: 'GOOGLE_NOT_CONNECTED' };
    }

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

      if (!options?.skipRevalidate) revalidatePath('/admin/contacts');
      const syncState = await db.contact.findUnique({
        where: { id: contactId },
        select: { googleContactId: true, lastGoogleSync: true, googleContactUpdatedAt: true, error: true }
      });
      const contactPatch = await getContactPatch();
      return { success: true, message: 'Resolved: Updated local contact from Google.', syncState, contactPatch };
    }

    // 3. LINK ONLY
    if (resolution === 'link_only' && googleData?.resourceName) {
      console.log(`[Resolve Conflict] Linking Local ${contactId} to Google ${googleData.resourceName}`);

      await db.contact.update({
        where: { id: contactId },
        data: {
          googleContactId: googleData.resourceName,
          googleContactUpdatedAt: googleData.updateTime || new Date(),
          lastGoogleSync: new Date(),
          error: null
        }
      });

      if (!options?.skipRevalidate) revalidatePath('/admin/contacts');
      const syncState = await db.contact.findUnique({
        where: { id: contactId },
        select: { googleContactId: true, lastGoogleSync: true, googleContactUpdatedAt: true, error: true }
      });
      const contactPatch = await getContactPatch();
      return { success: true, message: 'Linked successfully.', syncState, contactPatch };
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
      }

      // Push to Google using current user
      const { syncContactToGoogle } = await import('@/lib/google/people');
      await syncContactToGoogle(user.id, contactId);

      if (!options?.skipRevalidate) revalidatePath('/admin/contacts');
      const syncState = await db.contact.findUnique({
        where: { id: contactId },
        select: { googleContactId: true, lastGoogleSync: true, googleContactUpdatedAt: true, error: true }
      });
      const contactPatch = await getContactPatch();
      return { success: true, message: 'Pushed local data to Google.', syncState, contactPatch };
    }

    return { success: false, message: 'Invalid Resolution Action' };

  } catch (error: any) {
    if (error.message === 'GOOGLE_AUTH_EXPIRED') {
      return { success: false, message: 'GOOGLE_AUTH_EXPIRED' };
    }
    console.error('[resolveSyncConflict] Error:', error);
    return { success: false, message: 'Conflict Resolution Failed' };
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
  title: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  duration: z.coerce.number().int().min(5).max(480).default(60),
});

import { createAppointment } from '@/lib/ghl/calendars';
import { enqueueViewingSyncJobs } from '@/lib/viewings/sync-engine';

export async function createViewing(
  prevState: any,
  formData: FormData
) {
  const validatedFields = viewingSchema.safeParse({
    contactId: formData.get('contactId'),
    propertyId: formData.get('propertyId'),
    userId: formData.get('userId'),
    date: formData.get('date'),
    notes: formData.get('notes') || undefined,
    title: formData.get('title') || undefined,
    description: formData.get('description') || undefined,
    location: formData.get('location') || undefined,
    duration: formData.get('duration') || 60,
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
    const viewingResult = await db.viewing.create({
      data: {
        contactId: data.contactId,
        propertyId: data.propertyId,
        userId: data.userId,
        date: new Date(data.date),
        notes: data.notes,
        title: data.title || null,
        description: data.description || null,
        location: data.location || null,
        duration: data.duration,
        endAt: new Date(new Date(data.date).getTime() + data.duration * 60 * 1000),
        status: 'scheduled',
      }
    });

    await enqueueViewingSyncJobs({
      viewingId: viewingResult.id,
      operation: 'create',
    });

    // Fetch property reference for logging
    const propertyForLog = await db.property.findUnique({ where: { id: data.propertyId }, select: { reference: true, title: true } });
    const propertyRef = propertyForLog?.reference || propertyForLog?.title || 'Unknown Property';

    // Log Viewing Added
    await logContactHistory(db, data.contactId, internalUserId, 'VIEWING_ADDED', { property: propertyRef, date: data.date, notes: data.notes });

    revalidatePath(`/admin/properties/${data.propertyId}`);
    revalidatePath(`/admin/properties/${data.propertyId}`);

    // Trigger Google Sync for Visual ID Update (only if current user has Google connected)
    const currentUserForSync = await db.user.findUnique({
      where: { clerkId: currentUserId },
      select: { id: true, googleSyncEnabled: true, googleRefreshToken: true }
    });
    // DISABLED: Auto-sync removed. Use Google Sync Manager for manual sync.
    // if (currentUserForSync?.googleSyncEnabled && currentUserForSync?.googleRefreshToken) {
    //   const { syncContactToGoogle } = await import('@/lib/google/people');
    //   syncContactToGoogle(currentUserForSync.id, contact.id).catch(e => console.error(e));
    // }

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
    notes: formData.get('notes') || undefined,
    title: formData.get('title') || undefined,
    description: formData.get('description') || undefined,
    location: formData.get('location') || undefined,
    duration: formData.get('duration') || 60,
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
        title: validatedFields.data.title || null,
        description: validatedFields.data.description || null,
        location: validatedFields.data.location || null,
        duration: validatedFields.data.duration,
        endAt: new Date(new Date(validatedFields.data.date).getTime() + validatedFields.data.duration * 60 * 1000),
      }
    });

    await enqueueViewingSyncJobs({
      viewingId,
      operation: 'update',
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

      // Trigger Google Sync for Visual ID Update (only if current user has Google connected)
      const currentUserForSync = await db.user.findUnique({
        where: { clerkId: currentUserId },
        select: { id: true, googleSyncEnabled: true, googleRefreshToken: true }
      });
      // DISABLED: Auto-sync removed. Use Google Sync Manager for manual sync.
      // if (currentUserForSync?.googleSyncEnabled && currentUserForSync?.googleRefreshToken) {
      //   const { syncContactToGoogle } = await import('@/lib/google/people');
      //   syncContactToGoogle(currentUserForSync.id, contactId).catch(e => console.error(e));
      // }
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
    // Create the delete outbox jobs first
    await enqueueViewingSyncJobs({
      viewingId,
      operation: 'delete',
    });

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

export async function deleteContact(
  contactId: string,
  options?: {
    deleteFromGhl?: boolean;
    deleteFromGoogle?: boolean;
  }
) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    const contact = await db.contact.findUnique({
      where: { id: contactId },
      select: {
        locationId: true,
        ghlContactId: true,
        googleContactId: true
      }
    });
    if (!contact) return { success: false, message: 'Contact not found' };

    const hasAccess = await verifyUserHasAccessToLocation(userId, contact.locationId);
    if (!hasAccess) return { success: false, message: 'Unauthorized' };

    // 1. Delete from GoHighLevel
    if (options?.deleteFromGhl && contact.ghlContactId) {
      const location = await db.location.findUnique({
        where: { id: contact.locationId },
        select: { ghlLocationId: true }
      });
      if (location?.ghlLocationId) {
        const { deleteContactFromGHL } = await import('@/lib/ghl/stakeholders');
        await deleteContactFromGHL(location.ghlLocationId, contact.ghlContactId);
      }
    }

    // 2. Delete from Google Contacts
    if (options?.deleteFromGoogle && contact.googleContactId) {
      const user = await db.user.findUnique({
        where: { clerkId: userId },
        select: { id: true, googleSyncEnabled: true }
      });

      // Only allow if user has Google Sync enabled (implicit auth check)
      if (user?.googleSyncEnabled) {
        const { deleteContactFromGoogle } = await import('@/lib/google/people');
        await deleteContactFromGoogle(user.id, contact.googleContactId);
      }
    }

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

  // Check Outlook Connection
  const { getOutlookStatusAction } = await import('./outlook-actions');
  const outlookStatus = await getOutlookStatusAction();
  const isOutlookConnected = outlookStatus.connected;

  // Check Google connection (User-level)
  const dbUser = await db.user.findUnique({
    where: { clerkId: userId },
    select: { googleAccessToken: true, googleSyncEnabled: true }
  });
  const isGoogleConnected = !!(dbUser?.googleAccessToken && dbUser?.googleSyncEnabled);

  // Check GHL connection (Location-level)
  const locationObj = await db.location.findUnique({
    where: { id: contact.locationId },
    select: { ghlAccessToken: true }
  });
  const isGhlConnected = !!locationObj?.ghlAccessToken;

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
    leadSources: leadSources.map(s => s.name),
    isOutlookConnected,
    isGoogleConnected,
    isGhlConnected
  };
}



export async function unlinkGoogleContact(contactId: string, options?: { skipRevalidate?: boolean }) {
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
    if (!options?.skipRevalidate) revalidatePath('/admin/contacts');
    const syncState = await db.contact.findUnique({
      where: { id: contactId },
      select: { googleContactId: true, lastGoogleSync: true, googleContactUpdatedAt: true, error: true }
    });
    return { success: true, message: 'Contact unlinked from Google.', syncState };
  } catch (error: any) {
    return { success: false, message: 'Failed to unlink: ' + error.message };
  }
}

export async function verifyAndHealContact(contactId: string, error: string | null) {
  if (!error?.includes('Link broken') && !error?.includes('not found')) return;

  const { userId } = await auth();
  if (!userId) return;

  // Check connection
  const user = await db.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, googleSyncEnabled: true, googleRefreshToken: true }
  });

  if (user?.googleSyncEnabled && user?.googleRefreshToken) {
    console.log(`[Auto-Heal] broken link detected for contact ${contactId}. Attempting recovery...`);
    // This sync call will trigger the self-healing logic in people.ts (search & re-link)
    const { syncContactToGoogle } = await import('@/lib/google/people');
    await syncContactToGoogle(user.id, contactId).catch(e => console.error('[Auto-Heal] Failed:', e));
    revalidatePath(`/admin/contacts/${contactId}/view`);
  }
}

export async function searchContactsAction(query: string) {
  const { userId } = await auth();
  if (!userId) return [];

  const rawQuery = String(query || '').trim();
  if (rawQuery.length < 2) return [];

  const location = await getLocationContext();
  if (!location?.id) return [];

  const hasAccess = await verifyUserHasAccessToLocation(userId, location.id);
  if (!hasAccess) return [];

  const queryLower = rawQuery.toLowerCase();
  const queryDigits = rawQuery.replace(/\D/g, '');
  const queryDigitsShort = queryDigits.length >= 7 ? queryDigits.slice(-10) : queryDigits;
  const looksLikeEmail = rawQuery.includes('@');
  const nameTokens = rawQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const orClauses: any[] = [
    { name: { contains: rawQuery, mode: 'insensitive' } },
    { firstName: { contains: rawQuery, mode: 'insensitive' } },
    { lastName: { contains: rawQuery, mode: 'insensitive' } },
    { email: { contains: rawQuery, mode: 'insensitive' } },
  ];

  if (queryDigits.length >= 4) {
    orClauses.push({ phone: { contains: queryDigitsShort } });
    if (queryDigits.length >= 7) {
      orClauses.push({ phone: { contains: queryDigits.slice(-7) } });
    }
  } else if (rawQuery.length >= 2) {
    orClauses.push({ phone: { contains: rawQuery } });
  }

  if (looksLikeEmail) {
    orClauses.push({ email: { startsWith: rawQuery, mode: 'insensitive' } });
  }

  if (nameTokens.length >= 2) {
    const first = nameTokens[0];
    const last = nameTokens.slice(1).join(' ');
    orClauses.push({
      AND: [
        { firstName: { contains: first, mode: 'insensitive' } },
        { lastName: { contains: last, mode: 'insensitive' } },
      ]
    });
    orClauses.push({
      AND: [
        { firstName: { contains: last, mode: 'insensitive' } },
        { lastName: { contains: first, mode: 'insensitive' } },
      ]
    });
    orClauses.push({
      AND: nameTokens.map((token) => ({ name: { contains: token, mode: 'insensitive' } }))
    });
  }

  const contacts = await db.contact.findMany({
    where: {
      locationId: location.id,
      OR: orClauses,
    },
    take: 40,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      updatedAt: true,
      location: { select: { name: true } },
      conversations: {
        orderBy: { lastMessageAt: 'desc' },
        take: 1,
        select: { ghlConversationId: true, status: true }
      }
    }
  });

  const normalizeName = (value: string | null | undefined) =>
    String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  const normalizeDigits = (value: string | null | undefined) =>
    String(value || '').replace(/\D/g, '');

  const scored = contacts
    .map((contact) => {
      const email = String(contact.email || '').toLowerCase();
      const phoneDigits = normalizeDigits(contact.phone);
      const displayName = contact.name || [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null;
      const fullName = normalizeName(displayName || [contact.firstName, contact.lastName].filter(Boolean).join(' '));
      const firstName = normalizeName(contact.firstName);
      const lastName = normalizeName(contact.lastName);

      let score = 0;
      let matchReason = 'Match';

      if (queryDigits.length >= 7 && phoneDigits) {
        if (phoneDigits === queryDigits) {
          score = Math.max(score, 120);
          matchReason = 'Exact phone';
        } else if (phoneDigits.endsWith(queryDigits)) {
          score = Math.max(score, 110);
          matchReason = 'Phone suffix';
        } else if (queryDigitsShort && phoneDigits.includes(queryDigitsShort)) {
          score = Math.max(score, 95);
          matchReason = 'Phone contains';
        }
      }

      if (looksLikeEmail && email) {
        if (email === queryLower) {
          score = Math.max(score, 115);
          matchReason = 'Exact email';
        } else if (email.startsWith(queryLower)) {
          score = Math.max(score, 92);
          matchReason = 'Email prefix';
        } else if (email.includes(queryLower)) {
          score = Math.max(score, 80);
          matchReason = 'Email contains';
        }
      } else if (!looksLikeEmail && email && email.includes(queryLower)) {
        score = Math.max(score, 55);
        matchReason = 'Email contains';
      }

      if (fullName) {
        if (fullName === queryLower) {
          score = Math.max(score, 105);
          matchReason = 'Exact name';
        } else if (fullName.startsWith(queryLower)) {
          score = Math.max(score, 88);
          matchReason = 'Name prefix';
        } else if (fullName.includes(queryLower)) {
          score = Math.max(score, 72);
          matchReason = 'Name contains';
        }
      }

      if (nameTokens.length >= 2) {
        const tokenMatchCount = nameTokens.filter((token) => {
          const t = normalizeName(token);
          return !!t && (fullName.includes(t) || firstName.includes(t) || lastName.includes(t));
        }).length;
        if (tokenMatchCount === nameTokens.length) {
          score = Math.max(score, 90);
          matchReason = 'Full name tokens';
        }
      }

      const latestConversation = contact.conversations?.[0] || null;

      return {
        id: contact.id,
        name: contact.name,
        firstName: contact.firstName,
        lastName: contact.lastName,
        phone: contact.phone,
        email: contact.email,
        location: contact.location,
        conversationId: latestConversation?.ghlConversationId || null,
        conversationStatus: latestConversation?.status || null,
        matchReason,
        _score: score,
        _updatedAt: contact.updatedAt?.getTime?.() || 0,
      };
    })
    .filter((row) => row._score > 0 || (!queryDigits && !looksLikeEmail))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return b._updatedAt - a._updatedAt;
    })
    .slice(0, 12)
    .map(({ _score, _updatedAt, ...row }) => row);

  return scored;
}

export async function mergeContacts(sourceContactId: string, targetContactId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: "Unauthorized" };

  // Resolve internal user ID
  const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;

  try {
    await db.$transaction(async (tx) => {
      // 1. Get Source Contact Data
      const source = await tx.contact.findUnique({ where: { id: sourceContactId } });
      const target = await tx.contact.findUnique({ where: { id: targetContactId } });

      if (!source || !target) throw new Error("Contact not found");

      // 2. Transfer LID if target doesn't have one
      if (source.lid && !target.lid) {
        await tx.contact.update({
          where: { id: targetContactId },
          data: { lid: source.lid }
        });
      }

      // 3. Handle Conversations (Move or Merge)
      const sourceConvs = await tx.conversation.findMany({ where: { contactId: sourceContactId } });

      for (const sourceConv of sourceConvs) {
        // Check if target has conv in same location
        const targetConv = await tx.conversation.findUnique({
          where: {
            locationId_contactId: {
              locationId: sourceConv.locationId,
              contactId: targetContactId
            }
          }
        });

        if (targetConv) {
          console.log(`[Merge] Merging conversation ${sourceConv.id} into ${targetConv.id}`);
          // Move messages
          await tx.message.updateMany({
            where: { conversationId: sourceConv.id },
            data: { conversationId: targetConv.id }
          });
          // Delete source conv
          await tx.conversation.delete({ where: { id: sourceConv.id } });
        } else {
          console.log(`[Merge] Moving conversation ${sourceConv.id} to contact ${targetContactId}`);
          // Move conv
          await tx.conversation.update({
            where: { id: sourceConv.id },
            data: { contactId: targetContactId }
          });
        }
      }

      // 4. Delete Source Contact
      await tx.contact.delete({ where: { id: sourceContactId } });

      // Log History
      await logContactHistory(tx, targetContactId, internalUserId, "MERGED_FROM", { sourceId: sourceContactId, sourceName: source.name });
    });

    revalidatePath('/admin/contacts');
    return { success: true, message: "Merged successfully" };
  } catch (error: any) {
    console.error("Merge error:", error);
    return { success: false, message: error.message };
  }
}
