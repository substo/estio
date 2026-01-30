'use server';

import db from '@/lib/db';
import { auth } from '@clerk/nextjs/server';
import { verifyUserHasAccessToLocation } from '@/lib/auth/permissions';

export async function getProjectsForSelect(locationId: string) {
    try {
        const { userId } = await auth();
        if (!userId || !(await verifyUserHasAccessToLocation(userId, locationId))) {
            return [];
        }
        const projects = await db.project.findMany({
            where: { locationId },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        });
        return projects.map(p => ({ ...p, name: p.name || "Unknown Project" }));
    } catch (error) {
        console.error('Failed to fetch projects:', error);
        return [];
    }
}
