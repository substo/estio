import db from "../lib/db";
import { normalizeLidJid } from "../lib/whatsapp/identity";
import { upsertWebBridgeIdentityMap } from "../lib/whatsapp/web-bridge-identity";

const apply = process.argv.includes("--apply");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(1, Number(limitArg?.split("=")[1] || 250));

function digits(value: unknown) {
    return String(value || "").replace(/\D/g, "");
}

function lidFromWamId(wamId: string | null | undefined) {
    const match = String(wamId || "").match(/(?:true|false)_([0-9]+)@lid_/i);
    return match?.[1] ? normalizeLidJid(`${match[1]}@lid`) : "";
}

async function main() {
    const messages = await (db as any).message.findMany({
        where: {
            source: "whatsapp_web_bridge",
            wamId: { contains: "@lid" },
            conversation: {
                contact: {
                    phone: { not: null },
                },
            },
        },
        select: {
            wamId: true,
            conversation: {
                select: {
                    locationId: true,
                    contact: {
                        select: {
                            id: true,
                            locationId: true,
                            name: true,
                            phone: true,
                            lid: true,
                        },
                    },
                },
            },
        },
        take: limit,
        orderBy: { createdAt: "desc" },
    });

    const candidates = new Map<string, any>();
    for (const message of messages) {
        const contact = message.conversation?.contact;
        const lid = lidFromWamId(message.wamId);
        if (!contact?.id || !lid) continue;
        const lidDigits = digits(lid);
        const phoneDigits = digits(contact.phone);
        const looksFake =
            phoneDigits === lidDigits
            || String(contact.name || "").includes(lidDigits)
            || String(contact.name || "").startsWith("WhatsApp User +");
        if (!looksFake) continue;
        candidates.set(contact.id, {
            contact,
            lid,
            wamId: message.wamId,
        });
    }

    const rows = Array.from(candidates.values());
    console.log(JSON.stringify({
        mode: apply ? "apply" : "dry-run",
        scannedMessages: messages.length,
        candidateContacts: rows.length,
        examples: rows.slice(0, 20).map((row) => ({
            contactId: row.contact.id,
            locationId: row.contact.locationId,
            name: row.contact.name,
            currentPhone: row.contact.phone,
            currentLid: row.contact.lid,
            proposedLid: row.lid,
            evidenceWamId: row.wamId,
        })),
    }, null, 2));

    if (!apply) return;

    let repaired = 0;
    for (const row of rows) {
        await (db as any).contact.update({
            where: { id: row.contact.id },
            data: {
                phone: null,
                lid: row.lid,
                ...(String(row.contact.name || "").startsWith("WhatsApp User +") ? { name: "WhatsApp Contact" } : {}),
            },
        });
        await upsertWebBridgeIdentityMap({
            locationId: row.contact.locationId,
            contactId: row.contact.id,
            identityType: "lid",
            identityValue: row.lid,
            lid: row.lid,
            phone: null,
            displayName: String(row.contact.name || "") || "WhatsApp Contact",
            confidence: "unresolved",
            source: "lid_fake_phone_repair",
            metadata: { evidenceWamId: row.wamId, previousPhone: row.contact.phone },
        });
        repaired++;
    }

    console.log(JSON.stringify({ repaired }, null, 2));
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$disconnect();
    });
