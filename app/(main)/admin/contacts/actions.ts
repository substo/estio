'use server';

import { z } from 'zod';
import db from '@/lib/db';
import { revalidatePath } from 'next/cache';
import { auth } from '@clerk/nextjs/server';
import { after } from 'next/server';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';
import {
  LEAD_GOALS, LEAD_PRIORITIES, LEAD_STAGES, LEAD_SOURCES,
  REQUIREMENT_STATUSES, REQUIREMENT_CONDITIONS, CONTACT_TYPES, CONTACT_TYPE_CONFIG, type ContactType
} from '@/app/(main)/admin/contacts/_components/contact-types';
import { syncContactToGHL } from '@/lib/ghl/stakeholders';
import { runGoogleAutoSyncForContact } from '@/lib/google/automation';
import { enqueueContactSync } from '@/lib/contacts/sync-engine';
import { enqueueGhlContactSync, enqueueGoogleContactSync } from '@/lib/integrations/provider-outbox-enqueue';
import { Prisma } from '@prisma/client';
import { getLocationContext } from '@/lib/auth/location-context';
import { parseEvolutionMessageContent } from '@/lib/whatsapp/evolution-media';
import { seedConversationFromContactLeadText } from '@/lib/conversations/bootstrap';
import { normalizeReplyLanguage } from '@/lib/ai/reply-language-options';
import {
  normalizeIanaTimeZoneOrThrow,
  parseViewingDateTimeInput,
  ViewingDateTimeValidationError,
} from '@/lib/viewings/datetime';
import {
  generateViewingReminderDraft,
  getViewingReminderContext,
  queueDefaultViewingLeadReminders,
  type ViewingReminderAudience,
} from '@/lib/viewings/reminders';

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

function enqueueProviderContactMirrorsAfterResponse(args: {
  locationId: string;
  contactId: string;
  userId?: string | null;
  reason: string;
}) {
  after(async () => {
    try {
      await enqueueGhlContactSync({
        locationId: args.locationId,
        contactId: args.contactId,
        payload: { reason: args.reason },
      });
      await enqueueGoogleContactSync({
        locationId: args.locationId,
        contactId: args.contactId,
        userId: args.userId,
        payload: { reason: args.reason },
      });
    } catch (error) {
      console.error('[ProviderOutbox] Failed to enqueue contact mirrors:', error);
    }
  });
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

function parsePreferredLanguage(input: string | null | undefined): string | null {
  const raw = String(input || '').trim();
  if (!raw || raw.toLowerCase() === 'auto') return null;

  const normalized = normalizeReplyLanguage(raw);
  return normalized || null;
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

function getEntityRequirementError(
  data: ValidatedContactData,
  existingContactType?: string | null
): { field: 'entityId' | 'entityIds'; message: string } | null {
  const resolvedType = (data.contactType || existingContactType || 'Lead') as ContactType;
  const config = CONTACT_TYPE_CONFIG[resolvedType];
  if (!config || !config.entityRequired) return null;

  const hasEntityId = !!data.entityId;
  const hasEntityIds = Array.isArray(data.entityIds) && data.entityIds.length > 0;

  if (config.entityType === 'property') {
    if (config.multiEntity) {
      if (!hasEntityIds && !hasEntityId) {
        return { field: 'entityIds', message: 'Select at least one property.' };
      }
    } else if (!hasEntityId) {
      return { field: 'entityId', message: 'Select a property.' };
    }
  } else if (config.entityType === 'company') {
    if (!hasEntityId) {
      return { field: 'entityId', message: 'Select a company.' };
    }
  } else if (config.entityType === 'either') {
    if (!hasEntityId && !hasEntityIds) {
      return { field: 'entityId', message: 'Select a property or company.' };
    }
  }

  return null;
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
  preferredLang: z.string().optional().transform((value, ctx) => {
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === 'auto') return null;
    const normalized = parsePreferredLanguage(raw);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid preferred language code',
      });
      return z.NEVER;
    }
    return normalized;
  }),
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
  contact?: {
    id: string;
    name: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    preferredLang?: string | null;
    message?: string | null;
  };
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
        conversationId: existingConversation.id,
        legacyConversationId: existingConversation.ghlConversationId || null,
        isNew: false
      };
    }

    if (!contact.phone) {
      return { success: false, error: 'Contact has no phone number' };
    }

    const preferredChannelType = await resolvePreferredChannelTypeForPhone(location, contact.phone);

    const conversation = await db.conversation.create({
      data: {
        ghlConversationId: null,
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
      console.log(`[Contacts] Seeded new conversation ${conversation.id} from contact.message`);
    }

    return {
      success: true,
      conversationId: conversation.id,
      legacyConversationId: conversation.ghlConversationId || null,
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
          select: { id: true, ghlConversationId: true }
        });
        if (existingConversation) {
          return { success: true, conversationId: existingConversation.id, legacyConversationId: existingConversation.ghlConversationId || null, isNew: false };
        }
      }
    }
    return { success: false, error: error?.message || 'Failed to open conversation' };
  }
}

// --- Logic Helpers ---

// Prepares the Prisma data object from validated Zod data
function prepareContactInput(data: ValidatedContactData) {
  const preferredLang = data.preferredLang === undefined
    ? undefined
    : parsePreferredLanguage(data.preferredLang);

  return {
    name: data.name,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email || null,
    phone: data.phone || null,
    message: data.message,
    preferredLang,
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

async function findExistingContactForGoogleImport(
  locationId: string,
  googleData: { phone?: string | null; email?: string | null },
  resourceName: string
) {
  const existingSync = await db.contact.findFirst({
    where: { locationId, googleContactId: resourceName },
    select: { id: true, name: true, email: true, phone: true, googleContactId: true },
  });
  if (existingSync) return existingSync;

  if (googleData.email) {
    const existingEmail = await db.contact.findFirst({
      where: {
        locationId,
        email: { equals: googleData.email, mode: 'insensitive' },
      },
      select: { id: true, name: true, email: true, phone: true, googleContactId: true },
    });
    if (existingEmail) return existingEmail;
  }

  const rawDigits = String(googleData.phone || '').replace(/\D/g, '');
  if (rawDigits.length < 7) return null;

  const searchSuffix = rawDigits.length > 2 ? rawDigits.slice(-2) : rawDigits;
  const candidates = await db.contact.findMany({
    where: {
      locationId,
      phone: { contains: searchSuffix },
    },
    select: { id: true, name: true, email: true, phone: true, googleContactId: true },
  });

  return candidates.find((candidate) => {
    const candidateDigits = String(candidate.phone || '').replace(/\D/g, '');
    return candidateDigits === rawDigits
      || (candidateDigits.endsWith(rawDigits) && rawDigits.length >= 7)
      || (rawDigits.endsWith(candidateDigits) && candidateDigits.length >= 7);
  }) || null;
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
    preferredLang: formData.get('preferredLang') || undefined,
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

  const entityError = getEntityRequirementError(data);
  if (entityError) {
    return {
      errors: { [entityError.field]: [entityError.message] },
      message: entityError.message,
      success: false,
    };
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

      await enqueueContactSync(tx as Prisma.TransactionClient, {
        contactId: contact.id,
        locationId: data.locationId,
        operation: 'create',
        payload: { preferredUserId: internalUserId }
      });

      return contact;
    });

    enqueueProviderContactMirrorsAfterResponse({
      locationId: data.locationId,
      contactId: contact.id,
      userId: internalUserId,
      reason: 'contact_create',
    });

    revalidatePath('/admin/contacts');
    return {
      message: 'Contact created successfully.',
      success: true,
      contact: {
        id: contact.id,
        name: contact.name ?? '',
        firstName: contact.firstName ?? null,
        lastName: contact.lastName ?? null,
        email: contact.email,
        phone: contact.phone,
        preferredLang: contact.preferredLang ?? null,
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
  const t0 = performance.now();
  const log = (label: string) => console.log(`[updateContact:perf] ${label}: ${(performance.now() - t0).toFixed(0)}ms`);

  // Resolve internal user ID for history logging
  const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;
  log('1_resolveUser');

  // Also verify the contact actually belongs to this location
  const existingContactCheck = await db.contact.findUnique({
    where: { id: data.contactId },
    select: { locationId: true, contactType: true, ghlContactId: true }
  });
  log('2_existingCheck');

  if (!existingContactCheck || existingContactCheck.locationId !== data.locationId) {
    return { success: false, message: 'Contact not found or access denied.' };
  }

  const entityError = getEntityRequirementError(data, existingContactCheck.contactType);
  if (entityError) {
    return {
      errors: { [entityError.field]: [entityError.message] },
      message: entityError.message,
      success: false,
    };
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
    log('3_emailDupCheck');

    // Check for existing contact with same phone (excluding current contact)
    if (data.phone) {
      const phoneDuplicate = await checkPhoneDuplicate(data.locationId, data.phone, data.contactId);
      if (phoneDuplicate?.type === 'Exact') {
        return buildDuplicatePhoneState(phoneDuplicate.contact);
      }
    }
    log('4_phoneDupCheck');

    let savedContactSummary: CreateContactState["contact"] = undefined;

    await db.$transaction(async (tx) => {
      // Fetch current state for diffing
      const currentContact = await tx.contact.findUnique({ where: { id: data.contactId } });
      log('5_txFetchCurrent');

      const contactInput = prepareContactInput(data);
      const updatedContact = await tx.contact.update({
        where: { id: data.contactId },
        data: contactInput,
      });
      savedContactSummary = {
        id: updatedContact.id,
        name: updatedContact.name || '',
        firstName: updatedContact.firstName || null,
        lastName: updatedContact.lastName || null,
        email: updatedContact.email || null,
        phone: updatedContact.phone || null,
        preferredLang: updatedContact.preferredLang || null,
        message: updatedContact.message || null,
      };
      log('6_txUpdate');

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
        log('7_txEnrichChanges');

        const stageChangeIndex = changes.findIndex(c => c.field === 'leadStage');
        if (stageChangeIndex !== -1) {
          const stageChange = changes.splice(stageChangeIndex, 1)[0];
          await logContactHistory(tx, data.contactId, internalUserId, 'STAGE_CHANGED', [stageChange]);
        }

        if (changes.length > 0) {
          await logContactHistory(tx, data.contactId, internalUserId, 'UPDATED', changes);
        }
        log('8_txLogHistory');
      }

      await handleContactRoles(tx, data.contactId, data);
      log('9_txHandleRoles');

      await enqueueContactSync(tx as Prisma.TransactionClient, {
        contactId: data.contactId,
        locationId: data.locationId,
        operation: 'update',
        payload: { preferredUserId: internalUserId }
      });
    });
    log('10_txComplete');

    enqueueProviderContactMirrorsAfterResponse({
      locationId: data.locationId,
      contactId: data.contactId,
      userId: internalUserId,
      reason: 'contact_update',
    });

    log('11_returning');
    return { success: true, message: 'Contact updated successfully.', contact: savedContactSummary };

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
  const t0 = performance.now();
  const log = (label: string) => console.log(`[updateContact:outer:perf] ${label}: ${(performance.now() - t0).toFixed(0)}ms`);

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
    preferredLang: formData.get('preferredLang') || undefined,
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
  log('validation');

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
  log('auth');
  if (!hasAccess) {
    return { success: false, message: 'Unauthorized: You do not have access to this location.' };
  }

  const result = await updateContactCore(data, userId);
  log('core_complete');

  return {
    message: result.message || (result.success ? 'Contact updated successfully.' : 'Update failed'),
    success: result.success,
    errors: result.errors,
    duplicateContact: result.duplicateContact,
    contact: {
      id: data.contactId,
      name: data.name,
      firstName: data.firstName ?? null,
      lastName: data.lastName ?? null,
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

export async function importNewGoogleContactAction(resourceName: string, expectedLocationId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    const hasAccess = await verifyUserHasAccessToLocation(userId, expectedLocationId);
    if (!hasAccess) {
      return { success: false, message: 'Unauthorized: You do not have access to this location.' };
    }

    // Check current user's Google connection
    const user = await db.user.findUnique({
      where: { clerkId: userId },
      select: { id: true, googleSyncEnabled: true, googleRefreshToken: true }
    });

    if (!user?.googleSyncEnabled || !user?.googleRefreshToken) {
      return { success: false, message: 'GOOGLE_NOT_CONNECTED' };
    }

    const { getGoogleContact } = await import('@/lib/google/people');
    const googleData = await getGoogleContact(user.id, resourceName);

    if (!googleData) return { success: false, message: 'Contact not found in Google' };

    // Must have at least a name or some contact info
    if (!googleData.name && !googleData.email && !googleData.phone) {
      return { success: false, message: 'Google contact must have at least a name, email, or phone number.' };
    }

    const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    const internalUserId = dbUser?.id || null;

    const existingContact = await findExistingContactForGoogleImport(expectedLocationId, googleData, resourceName);
    if (existingContact) {
      if (!existingContact.googleContactId) {
        const updates: any = {
          googleContactId: resourceName,
          googleContactUpdatedAt: googleData.updateTime,
          lastGoogleSync: new Date(),
        };
        if (!existingContact.name && googleData.name) updates.name = googleData.name;
        if (!existingContact.email && googleData.email) updates.email = googleData.email;
        if (!existingContact.phone && googleData.phone) updates.phone = googleData.phone;

        await db.$transaction(async (tx) => {
          await tx.contact.update({
            where: { id: existingContact.id },
            data: updates,
          });
          await logContactHistory(tx, existingContact.id, internalUserId, 'LINKED_TO_GOOGLE', {
            googleContactId: resourceName,
            matchedBy: existingContact.email && googleData.email ? 'email' : 'phone',
          });
        });

        revalidatePath('/admin/contacts');
        return {
          success: true,
          message: 'Existing contact linked to Google.',
          contactId: existingContact.id,
          existing: true,
          linked: true,
        };
      }

      return {
        success: true,
        message: existingContact.googleContactId === resourceName
          ? 'Google contact is already linked. Opening existing contact.'
          : 'Existing local contact found. Google link left unchanged.',
        contactId: existingContact.id,
        existing: true,
        linked: existingContact.googleContactId === resourceName,
      };
    }

    // Transaction to create contact cleanly
    const contact = await db.$transaction(async (tx) => {
      // Split name blindly (this isn't perfect for all names but matches standard logic)
      let firstName = '';
      let lastName = '';
      if (googleData.name) {
        const parts = googleData.name.split(' ');
        firstName = parts[0];
        lastName = parts.slice(1).join(' ');
      }

      const createdContact = await tx.contact.create({
        data: {
          locationId: expectedLocationId,
          name: googleData.name || 'Google Contact',
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          email: googleData.email || undefined,
          phone: googleData.phone || undefined,
          status: 'new',
          contactType: 'Lead',
          // Set as linked to Google immediately
          googleContactId: resourceName,
          googleContactUpdatedAt: googleData.updateTime,
          lastGoogleSync: new Date()
        }
      });

      await logContactHistory(tx, createdContact.id, internalUserId, 'CREATED_FROM_GOOGLE');

      await enqueueContactSync(tx as Prisma.TransactionClient, {
        contactId: createdContact.id,
        locationId: expectedLocationId,
        operation: 'create',
        payload: { preferredUserId: internalUserId },
        providers: ['ghl']
      });

      return createdContact;
    });

    revalidatePath('/admin/contacts');
    return { success: true, message: 'Contact imported successfully.', contactId: contact.id };

  } catch (error: any) {
    if (error.message === 'GOOGLE_AUTH_EXPIRED') {
      return { success: false, message: 'GOOGLE_AUTH_EXPIRED' };
    }
    console.error('[importNewGoogleContactAction] Error:', error);
    return { success: false, message: 'Failed to import Google contact' };
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
  locationId: z.string().min(1, 'Location ID is required'),
  contactId: z.string().optional().nullable(),
  propertyId: z.string().optional().nullable(),
  userId: z.string().min(1, 'Agent/User ID is required'),
  date: z.string().optional(),
  scheduledAtIso: z.string().optional(),
  scheduledLocal: z.string().optional(),
  scheduledTimeZone: z.string().optional(),
  notes: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  duration: z.coerce.number().int().min(15).max(480).multipleOf(15).default(30),
});

type ResolvedViewingAgentTimeZone =
  | { ok: true; timeZone: string; source: 'user' | 'location' }
  | { ok: false; message: string };

async function resolveViewingAgentTimeZone(params: {
  agentUserId: string;
  locationId: string;
}): Promise<ResolvedViewingAgentTimeZone> {
  const [agent, location] = await Promise.all([
    db.user.findUnique({
      where: { id: params.agentUserId },
      select: { id: true, timeZone: true },
    }),
    db.location.findUnique({
      where: { id: params.locationId },
      select: { timeZone: true },
    }),
  ]);

  if (!agent?.id) {
    return { ok: false, message: 'Assigned agent not found.' };
  }

  if (agent.timeZone) {
    try {
      return { ok: true, timeZone: normalizeIanaTimeZoneOrThrow(agent.timeZone), source: 'user' };
    } catch {
      return {
        ok: false,
        message: `Assigned agent timezone is invalid (${agent.timeZone}). Update the agent profile timezone.`,
      };
    }
  }

  if (location?.timeZone) {
    try {
      return { ok: true, timeZone: normalizeIanaTimeZoneOrThrow(location.timeZone), source: 'location' };
    } catch {
      return {
        ok: false,
        message: `Location timezone is invalid (${location.timeZone}). Update the location timezone.`,
      };
    }
  }

  return {
    ok: false,
    message: 'Missing timezone for viewing scheduling. Set agent timezone first, or set the location timezone as fallback.',
  };
}

function getViewingDateTimeTelemetryBucket(error: unknown): string {
  if (!(error instanceof ViewingDateTimeValidationError)) return 'unknown';

  if (error.code === 'MISSING_TIMEZONE' || error.code === 'INVALID_TIMEZONE') return 'missing_timezone';
  if (error.code === 'DST_AMBIGUOUS_LOCAL_TIME') return 'dst_ambiguous_local_time';
  if (error.code === 'DST_INVALID_LOCAL_TIME') return 'invalid_local_time_dst_gap';
  if (error.code === 'INVALID_LOCAL_DATETIME') return 'invalid_local_time';
  if (error.code === 'INVALID_ABSOLUTE_DATETIME') return 'invalid_absolute_time';
  return 'unknown';
}

function toViewingDateTimeErrorMessage(error: unknown): string {
  if (!(error instanceof ViewingDateTimeValidationError)) {
    return 'Failed to parse viewing datetime.';
  }

  if (error.code === 'MISSING_TIMEZONE' || error.code === 'INVALID_TIMEZONE') {
    return 'Missing or invalid timezone for viewing scheduling. Set agent timezone first, or location timezone as fallback.';
  }
  if (error.code === 'DST_AMBIGUOUS_LOCAL_TIME') {
    return 'Selected local time is ambiguous due to DST change. Please choose a different time.';
  }
  if (error.code === 'DST_INVALID_LOCAL_TIME') {
    return 'Selected local time does not exist due to DST change. Please choose a different time.';
  }
  if (error.code === 'INVALID_LOCAL_DATETIME' || error.code === 'INVALID_ABSOLUTE_DATETIME') {
    return 'Invalid viewing date/time format.';
  }
  return error.message || 'Failed to parse viewing datetime.';
}

async function syncContactInspectedPropertiesFromViewings(
  prismaClient: any,
  contactId: string
): Promise<string[]> {
  const viewingRows = await prismaClient.viewing.findMany({
    where: { contactId },
    orderBy: [{ date: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
    select: { propertyId: true }
  });

  const dedupedPropertyIds: string[] = Array.from(new Set<string>(
    viewingRows
      .map((row: any) => String(row?.propertyId || '').trim())
      .filter(Boolean)
  ));

  await prismaClient.contact.update({
    where: { id: contactId },
    data: { propertiesInspected: dedupedPropertyIds }
  });

  return dedupedPropertyIds;
}

import { createAppointment } from '@/lib/ghl/calendars';
import {
  enqueueViewingSyncJobs,
  type EnqueueViewingSyncJobsResult,
} from '@/lib/viewings/sync-engine';
import { triggerTaskSyncCronNow } from '@/lib/cron/task-sync-trigger';

export async function createViewing(
  prevState: any,
  formData: FormData
) {
  const validatedFields = viewingSchema.safeParse({
    locationId: formData.get('locationId'),
    contactId: formData.get('contactId') || undefined,
    propertyId: formData.get('propertyId') || undefined,
    userId: formData.get('userId'),
    date: formData.get('date') || undefined,
    scheduledAtIso: formData.get('scheduledAtIso') || undefined,
    scheduledLocal: formData.get('scheduledLocal') || undefined,
    scheduledTimeZone: formData.get('scheduledTimeZone') || undefined,
    notes: formData.get('notes') || undefined,
    title: formData.get('title') || undefined,
    description: formData.get('description') || undefined,
    location: formData.get('location') || undefined,
    duration: formData.get('duration') || 30,
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Missing Fields. Failed to Create Viewing.',
      success: false,
    };
  }

  const data = validatedFields.data;
  if (!data.date && !data.scheduledAtIso && !data.scheduledLocal) {
    return {
      message: 'Date is required to schedule a viewing.',
      success: false,
    };
  }

  const { userId: currentUserId } = await auth();
  if (!currentUserId) return { success: false, message: 'Unauthorized' };

  // Resolve internal user ID for history logging
  const dbUser = await db.user.findUnique({ where: { clerkId: currentUserId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;

  const resolvedAgentTimeZone = await resolveViewingAgentTimeZone({
    agentUserId: data.userId,
    locationId: data.locationId,
  });
  if (!resolvedAgentTimeZone.ok) {
    return { success: false, message: resolvedAgentTimeZone.message };
  }

  let parsedSchedule;
  try {
    if (data.scheduledTimeZone && data.scheduledTimeZone !== resolvedAgentTimeZone.timeZone) {
      console.warn('[viewing_datetime_timezone_mismatch]', {
        operation: 'create',
        contactId: data.contactId,
        propertyId: data.propertyId,
        agentUserId: data.userId,
        scheduledTimeZoneInput: data.scheduledTimeZone,
        resolvedAgentTimeZone: resolvedAgentTimeZone.timeZone,
      });
    }

    parsedSchedule = parseViewingDateTimeInput({
      scheduledLocal: data.scheduledLocal || null,
      scheduledAtIso: data.scheduledAtIso || data.date || null,
      scheduledTimeZone: resolvedAgentTimeZone.timeZone,
      agentTimeZone: resolvedAgentTimeZone.timeZone,
    });

    console.info('[viewing_datetime_parse]', {
      operation: 'create',
      contactId: data.contactId,
      propertyId: data.propertyId,
      agentUserId: data.userId,
      localInput: data.scheduledLocal || data.date || null,
      timeZoneInput: data.scheduledTimeZone || null,
      resolvedAgentTimeZone: resolvedAgentTimeZone.timeZone,
      resolvedTimeZoneSource: resolvedAgentTimeZone.source,
      parsedSource: parsedSchedule.source,
      parsedScheduledLocal: parsedSchedule.scheduledLocal,
      parsedUtc: parsedSchedule.utcDate.toISOString(),
    });
  } catch (error) {
    console.warn('[viewing_datetime_error]', {
      operation: 'create',
      contactId: data.contactId,
      propertyId: data.propertyId,
      agentUserId: data.userId,
      localInput: data.scheduledLocal || data.date || null,
      timeZoneInput: data.scheduledTimeZone || null,
      resolvedAgentTimeZone: resolvedAgentTimeZone.timeZone,
      bucket: getViewingDateTimeTelemetryBucket(error),
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: toViewingDateTimeErrorMessage(error),
    };
  }

  try {
    const endAt = new Date(parsedSchedule.utcDate.getTime() + data.duration * 60 * 1000);
    const viewingResult = await db.viewing.create({
      data: {
        // @ts-ignore: Prisma types cache might not reflect the optional schema change yet
        contactId: data.contactId || null,
        // @ts-ignore: Prisma types cache might not reflect the optional schema change yet
        propertyId: data.propertyId || null,
        userId: data.userId,
        date: parsedSchedule.utcDate,
        scheduledTimeZone: parsedSchedule.scheduledTimeZone,
        scheduledLocal: parsedSchedule.scheduledLocal,
        notes: data.notes,
        title: data.title || null,
        description: data.description || null,
        location: data.location || null,
        duration: data.duration,
        endAt,
        status: 'scheduled',
      }
    });

    const syncResult: EnqueueViewingSyncJobsResult = await enqueueViewingSyncJobs({
      viewingId: viewingResult.id,
      operation: 'create',
    });

    if (data.contactId) {
      // Fetch property reference for logging
      let propertyRef = 'Unknown Property';
      if (data.propertyId) {
        const propertyForLog = await db.property.findUnique({ where: { id: data.propertyId }, select: { reference: true, title: true } });
        propertyRef = propertyForLog?.reference || propertyForLog?.title || 'Unknown Property';
      }

      // Log Viewing Added
      await logContactHistory(db, data.contactId, internalUserId, 'VIEWING_ADDED', {
        property: propertyRef,
        date: parsedSchedule.utcDate.toISOString(),
        scheduledLocal: parsedSchedule.scheduledLocal,
        timeZone: parsedSchedule.scheduledTimeZone,
        notes: data.notes,
      });

      await syncContactInspectedPropertiesFromViewings(db, data.contactId);
    }

    if (data.propertyId) {
      revalidatePath(`/admin/properties/${data.propertyId}`);
    }
    revalidatePath('/admin/contacts');

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

    return {
      success: true,
      message: 'Viewing scheduled successfully!',
      queuedProviders: syncResult.queuedProviders,
      skippedProviders: syncResult.skippedProviders,
    };
  } catch (error: any) {
    console.error('Failed to create viewing:', error);
    return { success: false, message: `Failed to create viewing: ${error?.message || String(error)}` };
  }
}

export async function updateViewing(
  prevState: any,
  formData: FormData
) {
  const viewingId = formData.get('viewingId') as string;
  const validatedFields = viewingSchema.safeParse({
    locationId: formData.get('locationId'),
    contactId: formData.get('contactId') || undefined,
    propertyId: formData.get('propertyId') || undefined,
    userId: formData.get('userId'),
    date: formData.get('date') || undefined,
    scheduledAtIso: formData.get('scheduledAtIso') || undefined,
    scheduledLocal: formData.get('scheduledLocal') || undefined,
    scheduledTimeZone: formData.get('scheduledTimeZone') || undefined,
    notes: formData.get('notes') || undefined,
    title: formData.get('title') || undefined,
    description: formData.get('description') || undefined,
    location: formData.get('location') || undefined,
    duration: formData.get('duration') || 30,
  });

  if (!validatedFields.success || !viewingId) {
    return {
      errors: validatedFields.error?.flatten().fieldErrors,
      message: 'Missing Fields or ID. Failed to Update Viewing.',
      success: false,
    };
  }

  if (!validatedFields.data.date && !validatedFields.data.scheduledAtIso && !validatedFields.data.scheduledLocal) {
    return {
      message: 'Date is required to update viewing.',
      success: false,
    };
  }

  const { userId: currentUserId } = await auth();
  if (!currentUserId) return { success: false, message: 'Unauthorized' };

  // Resolve internal user ID for history logging
  const dbUser = await db.user.findUnique({ where: { clerkId: currentUserId }, select: { id: true } });
  const internalUserId = dbUser?.id || null;

  const resolvedAgentTimeZone = await resolveViewingAgentTimeZone({
    agentUserId: validatedFields.data.userId,
    locationId: validatedFields.data.locationId,
  });
  if (!resolvedAgentTimeZone.ok) {
    return { success: false, message: resolvedAgentTimeZone.message };
  }

  let parsedSchedule;
  try {
    if (validatedFields.data.scheduledTimeZone && validatedFields.data.scheduledTimeZone !== resolvedAgentTimeZone.timeZone) {
      console.warn('[viewing_datetime_timezone_mismatch]', {
        operation: 'update',
        viewingId,
        contactId: validatedFields.data.contactId,
        propertyId: validatedFields.data.propertyId,
        agentUserId: validatedFields.data.userId,
        scheduledTimeZoneInput: validatedFields.data.scheduledTimeZone,
        resolvedAgentTimeZone: resolvedAgentTimeZone.timeZone,
      });
    }

    parsedSchedule = parseViewingDateTimeInput({
      scheduledLocal: validatedFields.data.scheduledLocal || null,
      scheduledAtIso: validatedFields.data.scheduledAtIso || validatedFields.data.date || null,
      scheduledTimeZone: resolvedAgentTimeZone.timeZone,
      agentTimeZone: resolvedAgentTimeZone.timeZone,
    });

    console.info('[viewing_datetime_parse]', {
      operation: 'update',
      viewingId,
      contactId: validatedFields.data.contactId,
      propertyId: validatedFields.data.propertyId,
      agentUserId: validatedFields.data.userId,
      localInput: validatedFields.data.scheduledLocal || validatedFields.data.date || null,
      timeZoneInput: validatedFields.data.scheduledTimeZone || null,
      resolvedAgentTimeZone: resolvedAgentTimeZone.timeZone,
      resolvedTimeZoneSource: resolvedAgentTimeZone.source,
      parsedSource: parsedSchedule.source,
      parsedScheduledLocal: parsedSchedule.scheduledLocal,
      parsedUtc: parsedSchedule.utcDate.toISOString(),
    });
  } catch (error) {
    console.warn('[viewing_datetime_error]', {
      operation: 'update',
      viewingId,
      contactId: validatedFields.data.contactId,
      propertyId: validatedFields.data.propertyId,
      agentUserId: validatedFields.data.userId,
      localInput: validatedFields.data.scheduledLocal || validatedFields.data.date || null,
      timeZoneInput: validatedFields.data.scheduledTimeZone || null,
      resolvedAgentTimeZone: resolvedAgentTimeZone.timeZone,
      bucket: getViewingDateTimeTelemetryBucket(error),
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      message: toViewingDateTimeErrorMessage(error),
    };
  }

  try {
    const endAt = new Date(parsedSchedule.utcDate.getTime() + validatedFields.data.duration * 60 * 1000);
    await db.viewing.update({
      where: { id: viewingId },
      data: {
        syncVersion: { increment: 1 },
        date: parsedSchedule.utcDate,
        scheduledTimeZone: parsedSchedule.scheduledTimeZone,
        scheduledLocal: parsedSchedule.scheduledLocal,
        userId: validatedFields.data.userId,
        // @ts-ignore: Prisma types cache might not reflect the optional schema change yet
        contactId: validatedFields.data.contactId || null,
        // @ts-ignore: Prisma types cache might not reflect the optional schema change yet
        propertyId: validatedFields.data.propertyId || null,
        notes: validatedFields.data.notes,
        title: validatedFields.data.title || null,
        description: validatedFields.data.description || null,
        location: validatedFields.data.location || null,
        duration: validatedFields.data.duration,
        endAt,
      }
    });

    await enqueueViewingSyncJobs({
      viewingId,
      operation: 'update',
    });

    // Trigger cron immediately so sync doesn't wait for the next scheduler tick.
    void triggerTaskSyncCronNow({
      source: 'viewing_update',
      viewingId,
      timeoutMs: 3500,
    })
      .catch((syncError) => {
        console.warn('[viewing_sync_trigger_failed]', {
          viewingId,
          error: syncError instanceof Error ? syncError.message : String(syncError),
        });
      });

    // Log Viewing Updated
    // We need contactId here, but it's in formData as optional/string. The schema validates it.
    // However, the updateViewing function doesn't seem to have contactId easily available from the update result?
    // The schema validation allows extracting it.
    const contactId = validatedFields.data.contactId;
    if (contactId) {
      let propertyRef = 'Unknown Property';
      if (validatedFields.data.propertyId) {
        const propertyForLog = await db.property.findUnique({ where: { id: validatedFields.data.propertyId }, select: { reference: true, title: true } });
        propertyRef = propertyForLog?.reference || propertyForLog?.title || 'Unknown Property';
      }

      await logContactHistory(db, contactId, internalUserId, 'VIEWING_UPDATED', {
        property: propertyRef,
        date: parsedSchedule.utcDate.toISOString(),
        scheduledLocal: parsedSchedule.scheduledLocal,
        timeZone: parsedSchedule.scheduledTimeZone,
        notes: validatedFields.data.notes,
      });

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

      await syncContactInspectedPropertiesFromViewings(db, contactId);
    }

    revalidatePath('/admin/contacts');
    return { success: true, message: 'Viewing updated successfully.' };
  } catch (e: any) {
    console.error(e);
    return { success: false, message: `Failed to update viewing: ${e?.message || String(e)}` };
  }
}

export async function deleteViewing(viewingId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: 'Unauthorized' };

  try {
    const existingViewing = await db.viewing.findUnique({
      where: { id: viewingId },
      select: { contactId: true, propertyId: true }
    });
    if (!existingViewing) {
      return { success: false, message: 'Viewing not found.' };
    }

    // Create the delete outbox jobs first
    await enqueueViewingSyncJobs({
      viewingId,
      operation: 'delete',
    });

    await db.viewing.delete({ where: { id: viewingId } });
    await syncContactInspectedPropertiesFromViewings(db, existingViewing.contactId);
    revalidatePath(`/admin/properties/${existingViewing.propertyId}`);
    revalidatePath('/admin/contacts');
    return { success: true, message: 'Viewing deleted.' };
  } catch (e) {
    return { success: false, message: 'Failed to delete viewing.' };
  }
}

async function verifyViewingReminderAccess(viewingId: string) {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false as const, error: 'Unauthorized' };
  }

  const context = await getViewingReminderContext(viewingId);
  if (!context) {
    return { ok: false as const, error: 'Viewing not found' };
  }

  if (!context.locationId) {
    return { ok: false as const, error: 'Viewing location context is missing' };
  }

  const hasAccess = await verifyUserHasAccessToLocation(userId, context.locationId);
  if (!hasAccess) {
    return { ok: false as const, error: 'Unauthorized' };
  }

  return { ok: true as const, context };
}

export async function generateViewingReminderDraftAction(
  viewingId: string,
  audience: ViewingReminderAudience
) {
  const access = await verifyViewingReminderAccess(viewingId);
  if (!access.ok) {
    return { success: false as const, error: access.error };
  }

  try {
    const result = await generateViewingReminderDraft({
      viewingId,
      audience,
      context: access.context,
      markGenerated: true,
    });

    revalidatePath('/admin/contacts');
    return {
      success: true as const,
      ...result,
    };
  } catch (error: any) {
    return {
      success: false as const,
      error: error?.message || 'Failed to generate viewing reminder draft.',
    };
  }
}

export async function queueViewingLeadRemindersAction(viewingId: string) {
  const access = await verifyViewingReminderAccess(viewingId);
  if (!access.ok) {
    return { success: false as const, error: access.error };
  }

  try {
    const result = await queueDefaultViewingLeadReminders(viewingId);
    revalidatePath('/admin/contacts');
    return result;
  } catch (error: any) {
    return {
      success: false as const,
      error: error?.message || 'Failed to queue viewing lead reminders.',
    };
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
    take: 20,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      createdAt: true,
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
        _createdAt: contact.createdAt?.getTime?.() || 0,
      };
    })
    .filter((row) => row._score > 0 || (!queryDigits && !looksLikeEmail))
    .sort((a, b) => {
      if (b._score !== a._score) return b._score - a._score;
      return b._createdAt - a._createdAt;
    })
    .slice(0, 12)
    .map(({ _score, _createdAt, ...row }) => row);

  return scored;
}

export async function mergeContacts(sourceContactId: string, targetContactId: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, message: "Unauthorized" };

  // Resolve internal user ID & Google sync capability
  const dbUser = await db.user.findUnique({
    where: { clerkId: userId },
    select: { id: true, googleSyncEnabled: true }
  });
  const internalUserId = dbUser?.id || null;

  let targetConversationId: string | null = null;

  // Pre-transaction: Read source + target with all external IDs for post-merge cleanup
  const source = await db.contact.findUnique({ where: { id: sourceContactId } });
  const target = await db.contact.findUnique({ where: { id: targetContactId } });

  if (!source) {
    // Check if already merged
    const mergeHistory = await db.contactHistory.findFirst({
      where: {
        action: "MERGED_FROM",
        changes: { string_contains: sourceContactId }
      },
      select: { contactId: true },
      orderBy: { createdAt: 'desc' }
    }).catch(() => null);

    return {
      success: false,
      message: mergeHistory
        ? `already_merged:${mergeHistory.contactId}`
        : "Contact not found"
    };
  }
  if (!target) return { success: false, message: "Contact not found" };

  // Resolve location for GHL operations
  const location = await db.location.findUnique({
    where: { id: source.locationId },
    select: { id: true, ghlLocationId: true, ghlAccessToken: true }
  });

  try {
    await db.$transaction(async (tx) => {
      // 1. Transfer LID if target doesn't have one
      if (source.lid && !target.lid) {
        await tx.contact.update({
          where: { id: targetContactId },
          data: { lid: source.lid }
        });
      }

      // 2. Handle Conversations (Move or Merge)
      const sourceConvs = await tx.conversation.findMany({ where: { contactId: sourceContactId } });

      for (const sourceConv of sourceConvs) {
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
          await tx.message.updateMany({
            where: { conversationId: sourceConv.id },
            data: { conversationId: targetConv.id }
          });
          await tx.conversation.delete({ where: { id: sourceConv.id } });
          targetConversationId = targetConv.id;
        } else {
          console.log(`[Merge] Moving conversation ${sourceConv.id} to contact ${targetContactId}`);
          await tx.conversation.update({
            where: { id: sourceConv.id },
            data: { contactId: targetContactId }
          });
          targetConversationId = sourceConv.id;
        }
      }

      if (!targetConversationId) {
        const existingTargetConv = await tx.conversation.findFirst({
          where: { contactId: targetContactId },
          orderBy: { lastMessageAt: 'desc' },
          select: { id: true }
        });
        targetConversationId = existingTargetConv?.id || null;
      }

      // 3. Transfer Property Roles (skip duplicates due to unique constraint)
      const sourcePropertyRoles = await tx.contactPropertyRole.findMany({
        where: { contactId: sourceContactId }
      });
      for (const role of sourcePropertyRoles) {
        const existsOnTarget = await tx.contactPropertyRole.findUnique({
          where: {
            contactId_propertyId_role: {
              contactId: targetContactId,
              propertyId: role.propertyId,
              role: role.role
            }
          }
        });
        if (existsOnTarget) {
          // Target already has this role — delete the source's duplicate
          await tx.contactPropertyRole.delete({ where: { id: role.id } });
        } else {
          await tx.contactPropertyRole.update({
            where: { id: role.id },
            data: { contactId: targetContactId }
          });
        }
      }

      // 4. Transfer Company Roles (skip duplicates)
      const sourceCompanyRoles = await tx.contactCompanyRole.findMany({
        where: { contactId: sourceContactId }
      });
      for (const role of sourceCompanyRoles) {
        const existsOnTarget = await tx.contactCompanyRole.findUnique({
          where: {
            contactId_companyId_role: {
              contactId: targetContactId,
              companyId: role.companyId,
              role: role.role
            }
          }
        });
        if (existsOnTarget) {
          await tx.contactCompanyRole.delete({ where: { id: role.id } });
        } else {
          await tx.contactCompanyRole.update({
            where: { id: role.id },
            data: { contactId: targetContactId }
          });
        }
      }

      // 5. Transfer Viewings
      await tx.viewing.updateMany({
        where: { contactId: sourceContactId },
        data: { contactId: targetContactId }
      });

      // 6. Transfer Swipes
      await tx.propertySwipe.updateMany({
        where: { contactId: sourceContactId },
        data: { contactId: targetContactId }
      });

      // Unlink SwipeSessions (can't move due to potential uniqueness)
      await tx.swipeSession.updateMany({
        where: { contactId: sourceContactId },
        data: { contactId: null }
      });

      // 7. Fill blank fields on target from source ("fill the gaps")
      const fillData: Record<string, any> = {};
      const scalarFields = [
        'email', 'phone', 'firstName', 'lastName', 'name',
        'address1', 'city', 'state', 'postalCode', 'country',
        'dateOfBirth', 'leadSource', 'leadPriority', 'leadGoal',
        'contactType', 'notes', 'preferredLang', 'message',
        'outlookContactId',
      ] as const;
      for (const field of scalarFields) {
        if (!(target as any)[field] && (source as any)[field]) {
          fillData[field] = (source as any)[field];
        }
      }

      // Merge tags (additive, deduplicated)
      const mergedTags = [...new Set([
        ...(target.tags || []),
        ...(source.tags || [])
      ])];
      if (mergedTags.length > (target.tags?.length || 0)) {
        fillData.tags = mergedTags;
      }

      // Merge property arrays (additive, deduplicated)
      const arrayFields = [
        'propertiesInterested', 'propertiesInspected',
        'propertiesEmailed', 'propertiesMatched'
      ] as const;
      for (const field of arrayFields) {
        const merged = [...new Set([
          ...((target as any)[field] || []),
          ...((source as any)[field] || [])
        ])];
        if (merged.length > ((target as any)[field]?.length || 0)) {
          fillData[field] = merged;
        }
      }

      if (Object.keys(fillData).length > 0) {
        await tx.contact.update({
          where: { id: targetContactId },
          data: fillData
        });
      }

      // 8. Delete Source Contact
      await tx.contact.delete({ where: { id: sourceContactId } });

      // 9. Enhanced Audit Log
      await logContactHistory(tx, targetContactId, internalUserId, "MERGED_FROM", {
        sourceId: sourceContactId,
        sourceName: source.name,
        sourcePhone: source.phone,
        sourceEmail: source.email,
        sourceLid: source.lid,
        sourceGhlContactId: source.ghlContactId,
        sourceGoogleContactId: source.googleContactId,
        sourceOutlookContactId: source.outlookContactId,
        fieldsFilled: Object.keys(fillData),
        rolesTransferred: {
          propertyRoles: sourcePropertyRoles.length,
          companyRoles: sourceCompanyRoles.length,
        },
      });

      await enqueueContactSync(tx as Prisma.TransactionClient, {
        contactId: targetContactId,
        locationId: target.locationId,
        operation: 'update',
        payload: { preferredUserId: dbUser?.id }
      });
    });

    // Post-transaction: External system cleanup (fire-and-forget via after())
    after(() => {
      void Promise.allSettled([
        // A. Delete source from Google Contacts
        (async () => {
          if (source.googleContactId && dbUser?.id && dbUser.googleSyncEnabled) {
            try {
              const { deleteContactFromGoogle } = await import('@/lib/google/people');
              const deleted = await deleteContactFromGoogle(dbUser.id, source.googleContactId);
              console.log(`[Merge] ${deleted ? 'Deleted' : 'Failed to delete'} source Google contact ${source.googleContactId}`);
            } catch (err) {
              console.error('[Merge] Google delete failed:', err);
            }
          }
        })(),

        // B. Delete source from GHL
        (async () => {
          if (source.ghlContactId && location?.ghlLocationId) {
            try {
              const { deleteContactFromGHL } = await import('@/lib/ghl/stakeholders');
              const deleted = await deleteContactFromGHL(location.ghlLocationId, source.ghlContactId);
              console.log(`[Merge] ${deleted ? 'Deleted' : 'Failed to delete'} source GHL contact ${source.ghlContactId}`);
            } catch (err) {
              console.error('[Merge] GHL delete failed:', err);
            }
          }
        })(),
      ]).catch(err => console.error('[Merge] External cleanup error:', err));
    });

    revalidatePath('/admin/contacts');
    revalidatePath('/admin/conversations');
    return { success: true, message: "Merged successfully", targetContactId, targetConversationId };
  } catch (error: any) {
    console.error("Merge error:", error);
    return { success: false, message: error.message };
  }
}

export async function updateContactStage(contactId: string, newStage: string) {
  const { userId } = await auth();
  if (!userId) return { success: false, error: 'Unauthorized' };

  const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  const contact = await db.contact.findUnique({
    where: { id: contactId },
    select: { leadStage: true, locationId: true }
  });

  if (!contact) return { success: false, error: 'Contact not found' };

  const hasAccess = await verifyUserHasAccessToLocation(userId, contact.locationId);
  if (!hasAccess) return { success: false, error: 'Unauthorized' };

  await db.$transaction(async (tx) => {
    await tx.contact.update({
      where: { id: contactId },
      data: { leadStage: newStage },
    });

    await logContactHistory(tx, contactId, dbUser?.id || null, 'STAGE_CHANGED', [
      { field: 'leadStage', old: contact.leadStage, new: newStage }
    ]);
  });

  revalidatePath('/admin/contacts');
  return { success: true };
}

/**
 * Save a contact from a shared WhatsApp contact card into the CRM.
 * If a contact with a matching phone already exists, returns the existing contact.
 */
export async function saveSharedContact(params: {
  locationId: string;
  displayName: string;
  phoneNumber?: string | null;
  email?: string | null;
  organization?: string | null;
}): Promise<{
  success: boolean;
  contactId?: string;
  isNew?: boolean;
  name?: string;
  error?: string;
}> {
  try {
    const { userId } = await auth();
    if (!userId) {
      return { success: false, error: 'Unauthorized' };
    }

    const location = await db.location.findFirst({
      where: {
        OR: [
          { id: params.locationId },
          { ghlLocationId: params.locationId }
        ]
      }
    });

    if (!location) {
      return { success: false, error: 'Location not found' };
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, location.id);
    if (!hasAccess) {
      return { success: false, error: 'Unauthorized' };
    }

    const normalizedPhone = normalizePhone(params.phoneNumber);
    const normalizedEmail = (params.email || '').trim().toLowerCase() || null;

    // Check for existing contact by phone
    if (normalizedPhone) {
      const rawDigits = normalizedPhone.replace(/\D/g, '');
      const searchSuffix = rawDigits.length > 7 ? rawDigits.slice(-7) : rawDigits;

      const candidates = await db.contact.findMany({
        where: {
          locationId: location.id,
          phone: { contains: searchSuffix },
        },
        select: { id: true, name: true, phone: true },
      });

      const exactMatch = candidates.find(c => {
        if (!c.phone) return false;
        const dbDigits = c.phone.replace(/\D/g, '');
        return dbDigits === rawDigits
          || (dbDigits.endsWith(rawDigits) && rawDigits.length >= 9)
          || (rawDigits.endsWith(dbDigits) && dbDigits.length >= 9);
      });

      if (exactMatch) {
        return {
          success: true,
          contactId: exactMatch.id,
          isNew: false,
          name: exactMatch.name || params.displayName,
        };
      }
    }

    // Check for existing contact by email
    if (normalizedEmail) {
      const emailMatch = await db.contact.findFirst({
        where: { locationId: location.id, email: normalizedEmail },
        select: { id: true, name: true },
      });

      if (emailMatch) {
        return {
          success: true,
          contactId: emailMatch.id,
          isNew: false,
          name: emailMatch.name || params.displayName,
        };
      }
    }

    // Parse display name into first/last
    const nameParts = params.displayName.trim().split(/\s+/);
    const firstName = nameParts[0] || params.displayName;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : undefined;

    // Resolve internal user ID for history logging
    const dbUser = await db.user.findUnique({ where: { clerkId: userId }, select: { id: true } });

    const contact = await db.$transaction(async (tx) => {
      const created = await tx.contact.create({
        data: {
          locationId: location.id,
          name: params.displayName,
          firstName,
          lastName,
          phone: normalizedPhone,
          email: normalizedEmail,
          contactType: 'Lead',
          status: 'new',
          leadSource: 'WhatsApp Contact Share',
          leadStage: 'Unassigned',
          leadPriority: 'Medium',
        },
      });

      await logContactHistory(tx, created.id, dbUser?.id || null, 'CREATED', {
        source: 'whatsapp_contact_share',
        sharedName: params.displayName,
        sharedPhone: normalizedPhone,
        sharedEmail: normalizedEmail,
        sharedOrganization: params.organization,
      });

      await enqueueContactSync(tx as Prisma.TransactionClient, {
        contactId: created.id,
        locationId: params.locationId,
        operation: 'create',
        payload: { preferredUserId: dbUser?.id }
      });

      return created;
    });

    return {
      success: true,
      contactId: contact.id,
      isNew: true,
      name: contact.name || params.displayName,
    };
  } catch (error: any) {
    // Handle unique constraint violation (phone/email already exists from concurrent request)
    if (String(error?.code) === 'P2002') {
      const field = String(error?.meta?.target || '');
      const isPhone = field.includes('phone');
      const isEmail = field.includes('email');

      const existing = await db.contact.findFirst({
        where: {
          locationId: location.id,
          ...(isPhone && params.phoneNumber ? { phone: normalizePhone(params.phoneNumber) } : {}),
          ...(isEmail && params.email ? { email: params.email.trim().toLowerCase() } : {}),
        },
        select: { id: true, name: true },
      });

      if (existing) {
        return {
          success: true,
          contactId: existing.id,
          isNew: false,
          name: existing.name || params.displayName,
        };
      }
    }

    console.error('[saveSharedContact] Error:', error);
    return { success: false, error: error?.message || 'Failed to save contact' };
  }
}

/**
 * Resolves the saved state of multiple contact phone numbers to hydrate message interfaces.
 */
export async function checkSharedContactsSavedState(
  locationId: string,
  phoneNumbers: string[]
) {
  try {
    const { userId } = await auth();
    if (!userId) return { success: false, error: 'Unauthorized' };

    // Resolve internal location ID
    const location = await db.location.findFirst({
      where: {
        OR: [
          { id: locationId },
          { ghlLocationId: locationId }
        ]
      },
      select: { id: true }
    });

    if (!location || !(await verifyUserHasAccessToLocation(userId, location.id))) {
       return { success: false, error: 'Location not found or unauthorized' };
    }

    const existingContacts = await db.contact.findMany({
      where: {
        locationId: location.id,
        phone: { in: phoneNumbers.map(normalizePhone).filter(Boolean) as string[] }
      },
      select: { 
        id: true, 
        phone: true,
        conversations: {
          take: 1,
          orderBy: { createdAt: 'desc' },
          select: { ghlConversationId: true }
        }
      }
    });

    const finalStates: Record<string, { saved: boolean; contactId: string; conversationId?: string }> = {};
    phoneNumbers.forEach(inputPhone => {
      const normalized = normalizePhone(inputPhone);
      if (!normalized) return;
      const matched = existingContacts.find(c => c.phone === normalized);
      if (matched) {
        finalStates[inputPhone] = { 
          saved: true, 
          contactId: matched.id,
          conversationId: matched.conversations?.[0]?.ghlConversationId 
        };
      }
    });

    return { success: true, states: finalStates };
  } catch (error: any) {
    console.error('[checkSharedContactsSavedState] Error:', error);
    return { success: false, error: error?.message || 'Failed to check contacts' };
  }
}
