import { test } from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@prisma/client";
import type { StudioDb } from "./db";
import { dispatchDueStudioSchedules, type DueSchedule } from "./schedule-dispatcher";
import { authorizeScheduledTextJob, authorizeEstioSchedule } from "./schedule-authority";
const due: DueSchedule={location_id:'location',schedule_id:'s',activation_token:'a',next_run_at:'2026-10-24T00:00:00Z',actor_app:'substo',authorized_by:'owner'};
function fixture(actor='substo') {
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 const db:StudioDb={rows:async<T>(q: Prisma.Sql)=>{assert.match(q.sql,/limit 25/);assert.match(q.sql,/enabled = \?/);return [{...due,actor_app:actor}] as T[];},
  one:async<T>()=>null,call:async<T>(name: string,args: Record<string,unknown>={})=>{calls.push({name,args});return {outcome:'queued'} as T;}};
 return {db,calls};
}
test('dispatch binds exact due and consent token; Substo authority stays in SQL',async()=>{
 const f=fixture();assert.deepEqual(await dispatchDueStudioSchedules({db:f.db,authorizeEstio:async()=>{throw Error('unexpected');}}),{examined:1,outcomes:{queued:1}});
 assert.deepEqual(f.calls[0],{name:'studio_dispatch_schedule',args:{p_location_id:'location',p_schedule_id:'s',p_activation_token:'a',p_due_at:due.next_run_at,p_estio_authorized:true}});
});
test('authority outage leaves due work retryable; confirmed denial reaches atomic SQL pause',async()=>{
 for(const outage of [false,true]) {const f=fixture('estio');const result=await dispatchDueStudioSchedules({db:f.db,authorizeEstio:async()=>{if(outage)throw Error('outage');return false;}});
  assert.equal(f.calls.length,outage?0:1);assert.equal(result.outcomes[outage?'unconfirmed':'queued'],1);if(!outage)assert.equal(f.calls[0].args.p_estio_authorized,false);
 }
});
test('schedule authority uses canonical Location and persisted same-realm author without workspace mirror',async()=>{
 let actor='estio',deleted=false;const db:StudioDb={...fixture().db,one:async<T>(q: Prisma.Sql)=>q.sql.includes('platform_profile_deletions')?(deleted?{clerk_user_id:'author'}:null) as T|null:({actor_app:actor,created_by_clerk_user_id:'author'} as T)};
 const check=async(user:string,location:string)=>user==='author'&&location==='location';
 assert.equal(await authorizeScheduledTextJob(db,'location','job',check),true);deleted=true;
 assert.equal(await authorizeEstioSchedule(db,'location','author',check),false);actor='substo';
 assert.equal(await authorizeScheduledTextJob(db,'location','job',check),true);
});
