import db from "../lib/db";
import { normalizeLidJid, normalizeLidRaw } from "../lib/whatsapp/identity";

const MARTIN_CONVERSATION_ID = "cmka6yguq0003eee6upyj802i";
const AUDREY_CONVERSATION_ID = "cmp1ie0j60003a4eazizduxti";
const AUDREY_LID = "79259527848167@lid";
const AUDREY_WAM_PREFIX = "true_79259527848167@lid_";

const apply = process.argv.includes("--apply");

function contactSummary(contact: any) {
    if (!contact) return null;
    return {
        id: contact.id,
        name: contact.name,
        phone: contact.phone,
        lid: contact.lid,
        lidMatchesAudrey: normalizeLidJid(contact.lid) === AUDREY_LID,
    };
}

async function main() {
    const [martinConversation, audreyConversation, misroutedMessages, identityMapRows, martinLidContacts] = await Promise.all([
        db.conversation.findUnique({
            where: { id: MARTIN_CONVERSATION_ID },
            select: {
                id: true,
                locationId: true,
                contactId: true,
                contact: { select: { id: true, name: true, phone: true, lid: true } },
            },
        }),
        db.conversation.findUnique({
            where: { id: AUDREY_CONVERSATION_ID },
            select: {
                id: true,
                locationId: true,
                contactId: true,
                contact: { select: { id: true, name: true, phone: true, lid: true } },
            },
        }),
        db.message.findMany({
            where: {
                conversationId: MARTIN_CONVERSATION_ID,
                wamId: { startsWith: AUDREY_WAM_PREFIX },
            },
            select: {
                id: true,
                wamId: true,
                type: true,
                direction: true,
                source: true,
                status: true,
                body: true,
                createdAt: true,
                updatedAt: true,
                attachments: { select: { id: true, fileName: true, contentType: true, url: true } },
                syncRecords: { select: { id: true, provider: true, conversationId: true, status: true } },
                providerOutboxJobs: { select: { id: true, provider: true, conversationId: true, status: true } },
            },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }),
        db.whatsAppIdentityMap.findMany({
            where: {
                provider: "whatsapp_web_bridge",
                OR: [
                    { identityValue: AUDREY_LID },
                    { lid: AUDREY_LID },
                    { lid: normalizeLidRaw(AUDREY_LID) || AUDREY_LID },
                ],
            },
            select: {
                id: true,
                locationId: true,
                contactId: true,
                identityType: true,
                identityValue: true,
                lid: true,
                phone: true,
                displayName: true,
                confidence: true,
                source: true,
                lastSeenAt: true,
                contact: { select: { id: true, name: true, phone: true, lid: true } },
            },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        }),
        db.contact.findMany({
            where: {
                OR: [
                    { id: "cmka6yg080001eee61rs37zut" },
                    { lid: AUDREY_LID },
                    { lid: normalizeLidRaw(AUDREY_LID) || AUDREY_LID },
                    { lid: { contains: normalizeLidRaw(AUDREY_LID) || AUDREY_LID } },
                ],
            },
            select: { id: true, locationId: true, name: true, phone: true, lid: true },
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        }),
    ]);

    const locationMatches = !!martinConversation?.locationId
        && martinConversation.locationId === audreyConversation?.locationId;
    const audreyContactLidMatches = normalizeLidJid(audreyConversation?.contact?.lid) === AUDREY_LID;
    const unsafeIdentityMapRows = identityMapRows.filter((row) => {
        if (!martinConversation?.contactId) return false;
        return row.contactId === martinConversation.contactId;
    });
    const martinContactLidPollution = martinLidContacts.filter((contact) => {
        return contact.id === martinConversation?.contactId
            && normalizeLidJid(contact.lid) === AUDREY_LID;
    });

    const summary = {
        mode: apply ? "apply" : "dry-run",
        martinConversation: {
            id: martinConversation?.id || null,
            locationId: martinConversation?.locationId || null,
            contact: contactSummary(martinConversation?.contact),
        },
        audreyConversation: {
            id: audreyConversation?.id || null,
            locationId: audreyConversation?.locationId || null,
            contact: contactSummary(audreyConversation?.contact),
        },
        checks: {
            locationMatches,
            audreyContactLidMatches,
            misroutedMessageCount: misroutedMessages.length,
            attachmentCount: misroutedMessages.reduce((sum, message) => sum + message.attachments.length, 0),
            unsafeIdentityMapRowCount: unsafeIdentityMapRows.length,
            martinContactLidPollutionCount: martinContactLidPollution.length,
        },
        messagesToMove: misroutedMessages.map((message) => ({
            id: message.id,
            wamId: message.wamId,
            type: message.type,
            direction: message.direction,
            source: message.source,
            status: message.status,
            createdAt: message.createdAt,
            attachmentCount: message.attachments.length,
            attachments: message.attachments.map((attachment) => ({
                id: attachment.id,
                fileName: attachment.fileName,
                contentType: attachment.contentType,
            })),
            syncRecordIds: message.syncRecords.map((record) => record.id),
            providerOutboxJobIds: message.providerOutboxJobs.map((job) => job.id),
        })),
        identityMapRowsForAudreyLid: identityMapRows.map((row) => ({
            id: row.id,
            contactId: row.contactId,
            contact: contactSummary(row.contact),
            identityType: row.identityType,
            identityValue: row.identityValue,
            lid: row.lid,
            phone: row.phone,
            displayName: row.displayName,
            confidence: row.confidence,
            source: row.source,
            lastSeenAt: row.lastSeenAt,
            mapsToMartinConversationContact: row.contactId === martinConversation?.contactId,
        })),
        contactsWithAudreyLidOrMartinContact: martinLidContacts.map(contactSummary),
    };

    console.log(JSON.stringify(summary, null, 2));

    if (!apply) return;

    if (!martinConversation || !audreyConversation) {
        throw new Error("Both Martin and Audrey conversations must exist before applying repair.");
    }
    if (!locationMatches) {
        throw new Error("Conversation locations differ; refusing repair.");
    }
    if (!audreyContactLidMatches) {
        throw new Error("Audrey conversation contact does not have the expected LID; refusing repair.");
    }

    const messageIds = misroutedMessages.map((message) => message.id);
    const unsafeIdentityMapIds = unsafeIdentityMapRows.map((row) => row.id);

    await db.$transaction(async (tx) => {
        if (messageIds.length > 0) {
            await tx.message.updateMany({
                where: {
                    id: { in: messageIds },
                    conversationId: MARTIN_CONVERSATION_ID,
                    wamId: { startsWith: AUDREY_WAM_PREFIX },
                },
                data: { conversationId: AUDREY_CONVERSATION_ID },
            });
            await tx.messageSync.updateMany({
                where: { messageId: { in: messageIds } },
                data: { conversationId: AUDREY_CONVERSATION_ID },
            });
            await tx.providerOutbox.updateMany({
                where: { messageId: { in: messageIds } },
                data: { conversationId: AUDREY_CONVERSATION_ID },
            });
        }

        if (unsafeIdentityMapIds.length > 0) {
            await tx.whatsAppIdentityMap.deleteMany({
                where: { id: { in: unsafeIdentityMapIds } },
            });
        }

        if (martinContactLidPollution.length > 0 && martinConversation.contactId) {
            await tx.contact.update({
                where: { id: martinConversation.contactId },
                data: { lid: null },
            });
        }
    });

    console.log(JSON.stringify({
        repaired: {
            movedMessageCount: messageIds.length,
            deletedIdentityMapRowCount: unsafeIdentityMapIds.length,
            clearedMartinContactLid: martinContactLidPollution.length > 0,
        },
    }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
