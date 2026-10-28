import assert from 'node:assert/strict';
import test from 'node:test';
import { brandProfileSpec } from './brand-profile';
import { requestStructuredText } from './openai-text';
const profile = { summary:'Synthetic business',audience:'Creators',offer:'Editing',tone:'Clear',useWords:[],avoidWords:[],pillars:[] };
test('brand drafting uses the existing metered provider contract with no tools',async()=>{
    let sent:any;
    const output=await requestStructuredText(brandProfileSpec,{answers:{offer:'Editing'},excerpts:[]},'synthetic-key',new AbortController().signal,async(_url,init)=>{
        sent=JSON.parse(String(init?.body));
        return Response.json({id:'resp_fixture',status:'completed',model:'gpt-6-luna',service_tier:'default',usage:{input_tokens:100,output_tokens:200,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(profile)}]}]});
    });
    assert.deepEqual(output.result,profile);assert.equal(output.costMicros,110);assert.deepEqual(sent.tools,[]);assert.equal(sent.store,false);assert.match(sent.instructions,/untrusted/);
});
test('draft validation rejects malformed provider output and oversize snapshots before calling provider',async()=>{
    assert.throws(()=>brandProfileSpec.validate({},{}));
    let called=false;
    await assert.rejects(requestStructuredText(brandProfileSpec,{answers:'x'.repeat(24001)},'fixture',new AbortController().signal,async()=>{called=true;return Response.json({});}));
    assert.equal(called,false);
});
