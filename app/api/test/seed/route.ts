import { NextResponse } from "next/server";
import db from "@/lib/db";
import { Prisma } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: Request) {
    try {
        const { initialMessage } = await req.json().catch(() => ({}));

        // 1. Find a valid location (just pick the first one)
        const location = await db.location.findFirst();
        if (!location) {
            return NextResponse.json({ error: "No location found in DB. Please create a location first." }, { status: 400 });
        }

        const TEST_PHONE = "+35796407286";
        const TEST_EMAIL = "martingreen@substo.com";

        // 2. Create or Update Test Contact
        let contact = await db.contact.findFirst({
            where: {
                locationId: location.id,
                phone: TEST_PHONE,
            },
        });

        if (!contact) {
            contact = await db.contact.create({
                data: {
                    locationId: location.id,
                    firstName: "AI Pipeline",
                    lastName: "Test Lead",
                    name: "AI Pipeline Test Lead",
                    phone: TEST_PHONE,
                    email: TEST_EMAIL,
                    contactType: "Lead",
                    status: "active",
                    leadScore: 0,
                    qualificationStage: "unqualified",
                },
            });
        } else {
            // Reset state for testing
            await db.contact.update({
                where: { id: contact.id },
                data: {
                    leadScore: 0,
                    qualificationStage: "unqualified",
                    leadGoal: null,
                    buyerProfile: Prisma.DbNull, // Clear profile using Prisma.DbNull
                }
            });

            // Clear previous insights for a fresh test
            await db.insight.deleteMany({
                where: { contactId: contact.id }
            });
        }

        // 3. Create or Update Conversation
        let conversation = await db.conversation.findFirst({
            where: {
                locationId: location.id,
                contactId: contact.id,
            },
        });

        if (!conversation) {
            conversation = await db.conversation.create({
                data: {
                    locationId: location.id,
                    contactId: contact.id,
                    ghlConversationId: `TEST-CONVO-${uuidv4()}`,
                    status: "open",
                    semiAuto: true,
                },
            });
        } else {
            // Ensure semiAuto is on
            await db.conversation.update({
                where: { id: conversation.id },
                data: { semiAuto: true }
            });
        }

        let result = null;

        // 4. (Optional) Simulate "Real Lead" Initial Message
        if (initialMessage) {
            // Create inbound message simulating webhook/SMS
            await db.message.create({
                data: {
                    conversationId: conversation.id,
                    type: "TYPE_SMS",
                    direction: "inbound",
                    status: "received",
                    body: initialMessage,
                    createdAt: new Date(),
                }
            });

            // Trigger automation immediately
            const { orchestrate } = await import("@/lib/ai/orchestrator");

            result = await orchestrate({
                conversationId: conversation.id,
                contactId: contact.id,
                message: initialMessage,
                conversationHistory: `User: ${initialMessage}`,
                dealStage: undefined
            });
        }

        return NextResponse.json({
            success: true,
            message: initialMessage ? "Test lead created and initial automation triggered" : "Test data seeded",
            locationId: location.id,
            contactId: contact.id,
            conversationId: conversation.id,
            contactName: contact.name,
            phone: contact.phone,
            automationResult: result // The first draft reply from the AI
        });

    } catch (error: any) {
        console.error("Seed error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
