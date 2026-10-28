import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeviceStudioQueue } from './http-queue';
test('companion accepts canonical Location IDs after the merge and retains UUID job lease checks', async()=>{
    const job={id:'11111111-1111-4111-8111-111111111111',location_id:'cmvntrnxm0001a4die51ayr85',kind:'studio.diagnostic',payload:{},lease_token:'22222222-2222-4222-8222-222222222222',lease_expires_at:'2026-10-28T23:00:00Z',attempts:1,max_attempts:5};
    const queue=createDeviceStudioQueue({origin:'https://substo.com',token:'studio_device_'+'a'.repeat(43)},{fetcher:async()=>Response.json({ok:true,data:[job]})});
    assert.equal((await queue.claim('worker',1,120))[0].location_id,job.location_id);
    const invalid=createDeviceStudioQueue({origin:'https://substo.com',token:'studio_device_'+'a'.repeat(43)},{fetcher:async()=>Response.json({ok:true,data:[{...job,lease_token:'invalid'}]})});
    await assert.rejects(invalid.claim('worker',1,120),/device_claim_failed/);
});
