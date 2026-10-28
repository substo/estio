import { Prisma } from '@prisma/client';
/** Prisma binds IDs as text; PostgreSQL's UUID equality requires explicit casts. */
export function activeSchedulesQuery(locationId: string, ids: string[]) {
    if (!ids.length) throw new Error('Select visible schedules first');
    return Prisma.sql`select schedule_id from studio.studio_schedule_recurring where location_id=${locationId}
        and schedule_id in (${Prisma.join(ids.map(id => Prisma.sql`${id}::uuid`))}) and enabled=true limit 20`;
}
