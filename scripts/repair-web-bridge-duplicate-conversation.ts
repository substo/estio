import db from "../lib/db";

const sourceConversationId = String(process.argv.find((arg) => arg.startsWith("--source="))?.split("=")[1] || "cmp5vzidq0019a4oxmxpx1o8y");
const targetConversationId = String(process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1] || "cmp5uf4bi001ta4kmm7bx00kq");
const apply = process.argv.includes("--apply");

async function count(model: any, where: any) {
    return model.count({ where }).catch(() => 0);
}

async function main() {
    const [source, target] = await Promise.all([
        (db as any).conversation.findUnique({ where: { id: sourceConversationId }, include: { contact: true, syncRecords: true } }),
        (db as any).conversation.findUnique({ where: { id: targetConversationId }, include: { contact: true, syncRecords: true } }),
    ]);

    if (!source) throw new Error(`Source conversation not found: ${sourceConversationId}`);
    if (!target) throw new Error(`Target conversation not found: ${targetConversationId}`);
    if (source.locationId !== target.locationId) throw new Error("Source and target conversations are in different locations.");
    if (source.id === target.id) throw new Error("Source and target conversations are the same.");

    const sourceContact = source.contact;
    const targetContact = target.contact;
    const sourceLid = String(sourceContact?.lid || "").trim();
    const targetPhone = String(targetContact?.phone || "").trim();
    const sourcePhoneDigits = String(sourceContact?.phone || "").replace(/\D/g, "");
    const sourceLidDigits = sourceLid.replace(/\D/g, "");
    const sourceHasFakeLidPhone = !!sourcePhoneDigits && !!sourceLidDigits && sourcePhoneDigits === sourceLidDigits;
    const isSafeSource = (!sourceContact?.phone || sourceHasFakeLidPhone) && !!sourceLid;
    const isSafeTarget = !!targetPhone;

    const counts = {
        messages: await count((db as any).message, { conversationId: source.id }),
        messageSyncRecords: await count((db as any).messageSync, { conversationId: source.id }),
        providerOutboxJobs: await count((db as any).providerOutbox, { conversationId: source.id }),
        whatsappOutboxJobs: await count((db as any).whatsAppOutboundOutbox, { conversationId: source.id }),
        contactTasks: await count((db as any).contactTask, { conversationId: source.id }),
        notifications: await count((db as any).userNotification, { conversationId: source.id }),
        dealLinks: await count((db as any).dealConversationLink, { conversationId: source.id }),
    };

    console.log(JSON.stringify({
        mode: apply ? "apply" : "dry-run",
        source: {
            conversationId: source.id,
            contactId: sourceContact?.id,
            name: sourceContact?.name,
            phone: sourceContact?.phone,
            lid: sourceContact?.lid,
        },
        target: {
            conversationId: target.id,
            contactId: targetContact?.id,
            name: targetContact?.name,
            phone: targetContact?.phone,
            lid: targetContact?.lid,
        },
        safeToMerge: isSafeSource && isSafeTarget,
        sourceHasFakeLidPhone,
        counts,
    }, null, 2));

    if (!isSafeSource || !isSafeTarget) {
        throw new Error("Refusing merge: source must be LID-only or fake-LID-phone, and target must have a real phone.");
    }
    if (!apply) return;

    await (db as any).$transaction(async (tx: any) => {
        const sourceSyncs = await tx.conversationSync.findMany({ where: { conversationId: source.id } });
        for (const sync of sourceSyncs) {
            const existingForTarget = await tx.conversationSync.findUnique({
                where: {
                    conversationId_provider_providerAccountId: {
                        conversationId: target.id,
                        provider: sync.provider,
                        providerAccountId: sync.providerAccountId,
                    },
                },
            }).catch(() => null);

            if (existingForTarget) {
                await tx.conversationSync.delete({ where: { id: sync.id } });
            } else {
                await tx.conversationSync.update({ where: { id: sync.id }, data: { conversationId: target.id } });
            }
        }

        await tx.message.updateMany({ where: { conversationId: source.id }, data: { conversationId: target.id } });
        await tx.messageSync.updateMany({ where: { conversationId: source.id }, data: { conversationId: target.id } }).catch(() => null);
        await tx.providerOutbox.updateMany({ where: { conversationId: source.id }, data: { conversationId: target.id } }).catch(() => null);
        await tx.whatsAppOutboundOutbox.updateMany({ where: { conversationId: source.id }, data: { conversationId: target.id } }).catch(() => null);
        await tx.contactTask.updateMany({ where: { conversationId: source.id }, data: { conversationId: target.id } }).catch(() => null);
        await tx.userNotification.updateMany({ where: { conversationId: source.id }, data: { conversationId: target.id } }).catch(() => null);
        await tx.dealConversationLink.updateMany({ where: { conversationId: source.id }, data: { conversationId: target.id } }).catch(() => null);

        await tx.contact.update({
            where: { id: targetContact.id },
            data: { lid: sourceLid },
        });
        await tx.whatsAppIdentityMap.updateMany({
            where: {
                locationId: source.locationId,
                provider: "whatsapp_web_bridge",
                OR: [{ contactId: sourceContact.id }, { lid: sourceLid }, { identityValue: sourceLid }],
            },
            data: {
                contactId: targetContact.id,
                phone: targetPhone,
                confidence: "high",
                source: "duplicate_conversation_repair",
            },
        });

        await tx.conversation.delete({ where: { id: source.id } });
        const remainingSourceConversations = await tx.conversation.count({ where: { contactId: sourceContact.id } });
        if (remainingSourceConversations === 0 && !sourceContact.phone) {
            await tx.contact.delete({ where: { id: sourceContact.id } });
        }
    });

    console.log("Merged duplicate Web Bridge conversation successfully.");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await (db as any).$disconnect?.();
    });
