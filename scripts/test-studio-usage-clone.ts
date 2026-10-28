// Requires the disposable drill socket. Never reads production configuration.
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { studioUsageQuery } from '../lib/ai/studio-usage-query';
const socket = process.env.STUDIO_DRILL_SOCKET;
if (!socket?.startsWith('/tmp/estio-unified-restore.')) throw new Error('Disposable restore socket required');
const db = new PrismaClient({ datasources: { db: { url: `postgresql://drill@localhost:55443/restored?host=${encodeURIComponent(socket)}` } } });
async function main() {
    const rollback = new Error('fixture rollback');
    try {
        await db.$transaction(async tx => {
            const locations = await tx.$queryRaw<Array<{id:string}>>`select id from public."Location" limit 2`;
            assert.equal(locations.length,2);
            const id=locations[0].id, other=locations[1].id;
            for (const [location,status,cost,date] of [[id,'settled',1000000,'2026-12-31T23:59:59Z'],[id,'settled',2000000,'2026-12-01T00:00:00Z'],[id,'settled',4000000,'2027-01-01T00:00:00Z'],[id,'released',null,null],[other,'settled',99000000,'2026-12-31T23:59:59Z']] as const) {
                await tx.$executeRaw`insert into studio.studio_ai_usage(location_id,provider,operation,status,reserved_micros,cost_micros,usage_month,settled_at) values(${location},'openai','fixture_usage',${status},10000,${cost},'2026-12-01'::date,${date}::timestamptz)`;
            }
            const rows = await tx.$queryRaw<any[]>(studioUsageQuery(id,new Date('2026-12-31T23:59:59Z')));
            const row=rows.find(row=>row.operation==='fixture_usage');
            assert.equal(Number(row.cost),7);assert.equal(Number(row.month_cost),3);assert.equal(Number(row.today_cost),1);
            assert.equal(Number(row.calls),3);assert.equal(Number(row.month_calls),2);assert.equal(Number(row.today_calls),1);
            throw rollback;
        });
    } catch(error) { if(error!==rollback) throw error; }
    console.log('Disposable usage aggregation: settlement, release, tenant isolation and UTC bounds passed; fixtures rolled back.');
}
main().finally(()=>db.$disconnect());
