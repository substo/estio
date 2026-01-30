'use server';

import db from "@/lib/db";
import { revalidatePath } from "next/cache";
import { upsertProject } from "@/lib/projects/repository";
import { redirect } from "next/navigation";
import { Project } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import { verifyUserHasAccessToLocation } from "@/lib/auth/permissions";

export type ActionState = {
    message: string;
    errors?: Record<string, string[]>;
    success: boolean;
    project?: Project;
};

export async function upsertProjectAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
    const locationId = formData.get("locationId") as string;
    const name = formData.get("name") as string;
    const ghlProjectId = formData.get("ghlProjectId") as string;

    if (!locationId || !name) {
        return {
            success: false,
            message: "Missing required fields (Location ID, Name)",
            errors: {
                name: !name ? ["Name is required"] : [],
            }
        };
    }

    const { userId } = await auth();
    if (!userId) {
        return {
            success: false,
            message: "Unauthorized"
        };
    }

    const hasAccess = await verifyUserHasAccessToLocation(userId, locationId);
    if (!hasAccess) {
        return {
            success: false,
            message: "Unauthorized: You do not have access to this location."
        };
    }

    // IDOR Check: If updating via ghlProjectId, ensure it belongs to this location
    if (ghlProjectId) {
        const existingProject = await db.project.findUnique({
            where: { ghlProjectId },
            select: { locationId: true }
        });

        if (existingProject && existingProject.locationId !== locationId) {
            console.error(`[Security] IDOR prevents access to project ${ghlProjectId} from location ${locationId}`);
            return {
                success: false,
                message: "Unauthorized: Request rejected."
            };
        }
    }

    try {
        const data = {
            name,
            description: formData.get("description") as string,
            developer: formData.get("developer") as string, // This will be the Company Name selected from the dropdown
            projectLocation: formData.get("projectLocation") as string,
            website: formData.get("website") as string,
            brochure: formData.get("brochure") as string,
            completionDate: formData.get("completionDate") ? new Date(formData.get("completionDate") as string) : undefined,
            totalUnits: formData.get("totalUnits") ? parseInt(formData.get("totalUnits") as string) : undefined,
            features: formData.getAll("features") as string[],
        };

        const project = await upsertProject(locationId, data, ghlProjectId || undefined);

        revalidatePath(`/admin/projects`);

        return {
            success: true,
            message: "Project saved successfully",
            project
        };
    } catch (error: any) {
        console.error("Failed to upsert project:", error);
        return {
            success: false,
            message: error.message || "Failed to save project"
        };
    }
}
