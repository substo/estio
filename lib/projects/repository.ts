import { ghlFetch } from '@/lib/ghl/client';
import db from '@/lib/db';
import { Project } from '@prisma/client';

const OBJECT_KEY = 'custom_objects.project';

export interface ProjectData {
    name: string;
    description?: string;
    developer?: string;
    completionDate?: Date;
    totalUnits?: number;
    features?: string[];
    projectLocation?: string;
    website?: string;
    brochure?: string;
    source?: string;
}

// Helper to map Prisma Project to GHL format
function mapPrismaToGHL(project: ProjectData) {
    return {
        name: project.name,
        description: project.description,
        developer: project.developer,
        completion_date: project.completionDate ? project.completionDate.toISOString().split('T')[0] : undefined,
        total_units: project.totalUnits,
        features: project.features,
        location: project.projectLocation,
        website: project.website,
        brochure: project.brochure,
    };
}

export interface ListProjectsParams {
    locationId: string;
    q?: string;
    developer?: string;
    hasProperties?: boolean;
}

export async function listProjects(params: ListProjectsParams) {
    const where: any = {
        locationId: params.locationId,
        AND: []
    };

    // Text Search (Name or Location)
    if (params.q) {
        where.AND.push({
            OR: [
                { name: { contains: params.q, mode: 'insensitive' } },
                { projectLocation: { contains: params.q, mode: 'insensitive' } }
            ]
        });
    }

    // Developer Exact/Partial Match
    if (params.developer) {
        where.AND.push({
            developer: { contains: params.developer, mode: 'insensitive' }
        });
    }

    // Has Properties Relation Filter
    if (params.hasProperties) {
        where.AND.push({
            properties: { some: {} }
        });
    }

    return db.project.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
            _count: {
                select: { properties: true }
            }
        }
    });
}


export async function upsertProject(
    locationId: string,
    data: ProjectData,
    ghlProjectId?: string
): Promise<Project> {
    // 1. Upsert to Local DB
    const payload = {
        locationId,
        name: data.name,
        description: data.description,
        developer: data.developer,
        completionDate: data.completionDate,
        totalUnits: data.totalUnits,
        features: data.features || [],
        projectLocation: data.projectLocation,
        website: data.website,
        brochure: data.brochure,
        source: data.source || 'Estio',
        ghlProjectId: ghlProjectId,
    };

    let project: Project;

    if (ghlProjectId) {
        project = await db.project.upsert({
            where: { ghlProjectId },
            update: payload,
            create: payload,
        });
    } else {
        // Try to find by name + location to avoid duplicates if no GHL ID
        const existing = await db.project.findFirst({
            where: {
                locationId,
                name: data.name
            }
        });

        if (existing) {
            project = await db.project.update({
                where: { id: existing.id },
                data: payload,
            });
        } else {
            project = await db.project.create({
                data: payload,
            });
        }
    }

    return project;
}

export async function syncProjectToGHL(
    accessToken: string,
    project: Project
): Promise<string | null> {
    // Loop Prevention: If source is GHL_WEBHOOK, do not sync back
    if (project.source === 'GHL_WEBHOOK') {
        console.log(`Skipping outbound sync for Project ${project.id} (Source: GHL_WEBHOOK)`);
        return project.ghlProjectId;
    }

    try {
        const ghlData = mapPrismaToGHL({
            name: project.name,
            description: project.description || undefined,
            developer: project.developer || undefined,
            completionDate: project.completionDate || undefined,
            totalUnits: project.totalUnits || undefined,
            features: project.features,
            projectLocation: project.projectLocation || undefined,
            website: project.website || undefined,
            brochure: project.brochure || undefined,
        });

        // Remove undefined values
        const cleanData: any = {};
        Object.keys(ghlData).forEach(key => {
            if ((ghlData as any)[key] !== undefined && (ghlData as any)[key] !== null) {
                cleanData[key] = (ghlData as any)[key];
            }
        });

        if (project.ghlProjectId) {
            // Update Existing
            console.log(`Syncing Project to GHL (Update): ${project.name}`);
            await ghlFetch(
                `/objects/${OBJECT_KEY}/records/${project.ghlProjectId}`,
                accessToken,
                {
                    method: 'PUT',
                    body: JSON.stringify({ properties: cleanData }),
                }
            );
            return project.ghlProjectId;
        } else {
            // Create New
            console.log(`Syncing Project to GHL (Create): ${project.name}`);
            const res = await ghlFetch<any>(
                `/objects/${OBJECT_KEY}/records`,
                accessToken,
                {
                    method: 'POST',
                    body: JSON.stringify({ properties: cleanData }),
                }
            );

            // Update local DB with the new GHL ID
            if (res && res.record && res.record.id) {
                await db.project.update({
                    where: { id: project.id },
                    data: { ghlProjectId: res.record.id }
                });
                return res.record.id;
            }
            return null;
        }
    } catch (error: any) {
        console.error('Failed to sync Project to GHL:', error.message);
        return null;
    }
}
