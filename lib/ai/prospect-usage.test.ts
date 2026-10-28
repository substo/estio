import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function fixture(text: string) {
    const recorded:any[]=[];let calls=0;
    const deps:Record<string,unknown>={
        './usage-metering':{securelyRecordAiUsage:async(input:any)=>{recorded.push(input);}},
        './llm':{callLLMWithMetadata:async()=>{calls++;return{text,provider:'google_gemini',model:'fixture',usage:{promptTokens:100,completionTokens:200,thoughtsTokens:50},fundingScope:'location_gemini'};}},
        './model-router':{getModelForTask:()=> 'fixture'},'@/lib/db':{},
        '@/lib/leads/seller-type':{normalizeProspectSellerType:()=> 'private',sellerTypeToLegacyAgencyFlag:()=>false},
    };
    const module={exports:{} as any};const code=ts.transpileModule(fs.readFileSync('lib/ai/prospect-classifier.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,console:{log(){},warn(){},error(){}},require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
    return {run:module.exports.classifyProspect,recorded,calls:()=>calls};
}
test('prospect classification requires a Location before making a paid request',async()=>{const f=fixture('{}');await assert.rejects(f.run({name:'Synthetic prospect'}),/Location is required/);assert.equal(f.calls(),0);});
test('prospect classification records returned usage even when the business response is invalid',async()=>{for(const text of ['{"sellerType":"private","confidenceScore":80,"reasoning":"Fixture"}','invalid JSON']){const f=fixture(text);await f.run({locationId:'location-a',name:'Synthetic prospect'});assert.equal(f.calls(),1);assert.equal(f.recorded.length,1);assert.equal(f.recorded[0].locationId,'location-a');assert.equal(f.recorded[0].outputTokens,250);assert.equal(f.recorded[0].userId,null);}});
