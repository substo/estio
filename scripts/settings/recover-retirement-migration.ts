/** One-time recovery of the observed, unapplied phase-6 SQL alias failure. Defaults to preview. */
import { execFileSync } from 'node:child_process';
import db from '../../lib/db';
import { settingsService } from '../../lib/settings/service';
import { SETTINGS_DOMAINS } from '../../lib/settings/constants';
import { planSiteConfigRetirement } from '../../lib/location-config/retire';
const migration = '20261105150000_retire_site_config';
async function main() {
 const failed = await db.$queryRaw<Array<{id:string;checksum:string;applied_steps_count:number;logs:string}>>`select id,checksum,applied_steps_count,logs from public._prisma_migrations where migration_name=${migration} and finished_at is null and rolled_back_at is null`;
 if (!failed.length) { console.log('No observed retirement failure to recover.'); return; }
 if (failed.length!==1 || failed[0].id!=='91b8cf39-ec5f-4506-8967-c9be2fb90db8' || failed[0].checksum!=='eca0c46b98a05c0aa653920a0ea10891ce96f888382bf88659ecdf6b20b9f8a3' || failed[0].applied_steps_count!==0 || !failed[0].logs.includes('column "k" does not exist')) throw Error('Unrecognized migration failure; separate diagnosis required');
 const rows=await db.$queryRawUnsafe<Record<string,unknown>[]>('select * from public."SearchConfig"');
 const keys=await db.$queryRaw<Array<{count:bigint}>>`select count(*) as count from studio.studio_location_ai_credentials`;
 if(rows.length!==2 || keys[0].count!==BigInt(0) || rows.map(r=>String(r.locationId)).sort().join(',')!==['cmshgqe2j0000a4jjw6152pjf','cmingx6b10008rdycg7hwesyn'].sort().join(',')) throw Error('Legacy recovery scope changed');
 for(const row of rows){
  const locationId=String(row.locationId);
  const [location,ai,website]=await Promise.all([db.location.findUnique({where:{id:locationId},select:{domain:true}}),settingsService.getDocument<Record<string,unknown>>({scopeType:'LOCATION',scopeId:locationId,domain:SETTINGS_DOMAINS.LOCATION_AI}),settingsService.getDocument<Record<string,unknown>>({scopeType:'LOCATION',scopeId:locationId,domain:SETTINGS_DOMAINS.LOCATION_PUBLIC_SITE})]);
  const plan=planSiteConfigRetirement({row,locationDomain:location?.domain??null,ai:ai?.payload??null,website:website?.payload??null});
  if(!location || Object.keys(plan.ai).length || Object.keys(plan.website).length || plan.domain) throw Error('Legacy data still needs copying; retirement refused');
 }
 console.log('Verified exact failed migration, two fully copied settings rows and zero legacy keys.');
 if(!process.argv.includes('--apply'))return;
 if(!process.env.ESTIO_DEPLOY_TOKEN || !process.env.ESTIO_LIVE_REVISION)throw Error('Recovery requires the owned server deployment lease');
 execFileSync('python3',['/usr/local/lib/estio/deploy-guard.py','check',process.env.ESTIO_DEPLOY_TOKEN,process.env.ESTIO_LIVE_REVISION],{stdio:'inherit'});
 execFileSync('node_modules/.bin/prisma',['migrate','resolve','--rolled-back',migration],{stdio:'inherit'});
 const [record]=await db.$queryRaw<Array<{rolled_back_at:Date|null}>>`select rolled_back_at from public._prisma_migrations where id=${failed[0].id}`;
 if(!record?.rolled_back_at)throw Error('Migration recovery was not recorded');
 console.log('Only the observed failed ledger record marked rolled back; migrate deploy owns schema application.');
}
main().catch(e=>{console.error(e instanceof Error?e.message:e);process.exitCode=1}).finally(()=>db.$disconnect());
