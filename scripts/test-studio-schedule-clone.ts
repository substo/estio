import {activeSchedulesQuery} from '../lib/studio/schedule-queries';
import {Prisma,PrismaClient} from '@prisma/client';
import assert from 'node:assert/strict';
const socket=process.env.STUDIO_DRILL_SOCKET;
if(!socket?.startsWith('/tmp/estio-unified-restore.'))throw new Error('Disposable restore socket required');
const db=new PrismaClient({datasources:{db:{url:`postgresql://drill@localhost:55443/restored?host=${encodeURIComponent(socket)}`}}});
async function main(){const visible=await db.$queryRaw<Array<{id:string;location_id:string}>>`select id,location_id from studio.studio_schedules limit 2`;assert.ok(visible.length);
 await assert.rejects(db.$queryRaw(Prisma.sql`select schedule_id from studio.studio_schedule_recurring where location_id=${visible[0].location_id} and schedule_id in (${Prisma.join(visible.map(s=>s.id))})`));
 await db.$queryRaw(activeSchedulesQuery(visible[0].location_id,visible.map(s=>s.id)));
 console.log('Restored PostgreSQL reproduces uncast UUID query failure and accepts corrected schedule query.');}
main().finally(()=>db.$disconnect());
