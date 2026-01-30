"use server";

import db from "@/lib/db";
import { cookies } from "next/headers";
import { z } from "zod";
import { randomUUID } from "crypto";

const swipeSchema = z.object({
    propertyId: z.string(),
    choice: z.enum(["INTERESTED", "MAYBE", "NOT"]),
    contactId: z.string().optional(),
});

export async function submitSwipe(data: z.infer<typeof swipeSchema>) {
    const validated = swipeSchema.parse(data);
    const cookieStore = await cookies();
    let anonymousKey = cookieStore.get("swipe_session_key")?.value;

    if (!anonymousKey) {
        anonymousKey = randomUUID();
        cookieStore.set("swipe_session_key", anonymousKey);
    }

    // Find existing session
    let session = null;

    if (validated.contactId) {
        session = await db.swipeSession.findFirst({
            where: { contactId: validated.contactId },
            orderBy: { startedAt: "desc" },
        });
    }

    if (!session) {
        session = await db.swipeSession.findFirst({
            where: { anonymousKey: anonymousKey },
            orderBy: { startedAt: "desc" },
        });
    }

    if (!session) {
        session = await db.swipeSession.create({
            data: {
                contactId: validated.contactId,
                anonymousKey: anonymousKey,
            },
        });
    } else {
        // If we have a contactId but the session doesn't, link it
        if (validated.contactId && !session.contactId) {
            session = await db.swipeSession.update({
                where: { id: session.id },
                data: { contactId: validated.contactId },
            });
        }
    }

    const scoreMap = {
        INTERESTED: 2,
        MAYBE: 1,
        NOT: 0,
    };

    const score = scoreMap[validated.choice];

    // Create PropertySwipe
    await db.propertySwipe.create({
        data: {
            sessionId: session.id,
            contactId: validated.contactId,
            propertyId: validated.propertyId,
            choice: validated.choice,
            score: score,
        },
    });

    // Increment totalSwipes
    await db.swipeSession.update({
        where: { id: session.id },
        data: {
            totalSwipes: { increment: 1 },
        },
    });

    // Update Contact and Role metrics if contact is identified
    if (validated.contactId) {
        // 1. Update Contact Heat
        const contact = await db.contact.findUnique({ where: { id: validated.contactId } });
        if (contact) {
            const newInterested = contact.interestedCount + (validated.choice === "INTERESTED" ? 1 : 0);
            const newMaybe = contact.maybeCount + (validated.choice === "MAYBE" ? 1 : 0);
            const newNot = contact.notCount + (validated.choice === "NOT" ? 1 : 0);

            // heatScore = 2 * interestedCount + maybeCount
            const newHeatScore = (2 * newInterested) + newMaybe;

            await db.contact.update({
                where: { id: contact.id },
                data: {
                    interestedCount: newInterested,
                    maybeCount: newMaybe,
                    notCount: newNot,
                    heatScore: newHeatScore,
                },
            });
        }

        // 2. Update ContactPropertyRole
        // Find any existing role for this contact/property
        let role = await db.contactPropertyRole.findFirst({
            where: {
                contactId: validated.contactId,
                propertyId: validated.propertyId,
            },
        });

        if (!role) {
            role = await db.contactPropertyRole.create({
                data: {
                    contactId: validated.contactId,
                    propertyId: validated.propertyId,
                    role: "Lead",
                    source: "swipe",
                },
            });
        }

        const newRoleInterested = role.interestedSwipes + (validated.choice === "INTERESTED" ? 1 : 0);
        const newRoleMaybe = role.maybeSwipes + (validated.choice === "MAYBE" ? 1 : 0);
        const newRoleNot = role.notSwipes + (validated.choice === "NOT" ? 1 : 0);

        // propertyHeatScore = 2 * interestedSwipes + maybeSwipes
        const newPropertyHeatScore = (2 * newRoleInterested) + newRoleMaybe;

        await db.contactPropertyRole.update({
            where: { id: role.id },
            data: {
                interestedSwipes: newRoleInterested,
                maybeSwipes: newRoleMaybe,
                notSwipes: newRoleNot,
                propertyHeatScore: newPropertyHeatScore,
            },
        });
    }

    return { success: true };
}
