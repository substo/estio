import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { propertyImportUsage } from './import-usage-policy';
function load(image: boolean) {
    const recorded: ReturnType<typeof propertyImportUsage>[] = [];
    let providerCalls = 0;
    const deps: Record<string,unknown> = {
        '@/lib/ai/import-usage': {recordPropertyImportUsage: async (input:any)=>{recorded.push(propertyImportUsage(input));}},
        '@/lib/auth/crm-action-guard': {}, '@/lib/db': {}, fs: {}, path: {},
        '@/lib/properties/filter-constants': {FEATURE_CATEGORIES:[]}, '@/lib/properties/constants': {PROPERTY_TYPES:[],RENTAL_PERIODS:[]},
        '@/lib/ai/pricing': {DEFAULT_MODEL:'gemini-fixture'},
        '@/lib/ai/llm': {callLLMWithMetadata:async()=>{providerCalls++;return {text:'{"title":"Fixture"}',provider:'openai_api',model:'fixture',usage:{promptTokens:100,completionTokens:200,thoughtsTokens:0},fundingScope:'location_openai',executionMode:'interactive'};}},
        '@/lib/ai/fetch-models': {}, '@/lib/properties/active-location-access': {}, '@/lib/ai/location-google-key': {},
    };
    const module={exports:{} as any};
    const source=fs.readFileSync('app/(main)/admin/properties/import/ai-property-extraction.ts','utf8')+'\nexports.testCallAiJSON=callAiJSON;';
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,console:{log(){},error(){}},require:(name:string)=>{assert.ok(name in deps,name);return deps[name];},
        fetch:async()=>{assert.ok(image);providerCalls++;return Response.json({usageMetadata:{promptTokenCount:100,candidatesTokenCount:200,thoughtsTokenCount:50},candidates:[{content:{parts:[{text:'invalid business JSON'}]}}]});}});
    return {run:module.exports.testCallAiJSON,recorded,calls:()=>providerCalls};
}
test('text import records returned usage once against its Location',async()=>{
    const fixture=load(false);const result=await fixture.run('location-a','synthetic-key','fixture','Synthetic prompt','DETAILS');
    assert.equal(result.success,true);assert.equal(fixture.calls(),1);assert.equal(fixture.recorded.length,1);
    assert.equal(fixture.recorded[0].locationId,'location-a');assert.equal(fixture.recorded[0].inputTokens,100);assert.equal(fixture.recorded[0].outputTokens,200);assert.equal(fixture.recorded[0].fundingScope,'location_openai');
});
test('vision usage includes reasoning tokens even when provider text has no usable business fields',async()=>{
    const fixture=load(true);const result=await fixture.run('location-b','synthetic-key','gemini-fixture','Synthetic prompt','VISION','synthetic-image');
    assert.equal(result.data,null);assert.equal(fixture.calls(),1);assert.equal(fixture.recorded.length,1);assert.equal(fixture.recorded[0].locationId,'location-b');assert.equal(fixture.recorded[0].outputTokens,250);
});
