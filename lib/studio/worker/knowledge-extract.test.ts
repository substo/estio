import { fixtureDb } from "../testing/fixture-db";
import assert from "node:assert/strict";
import test from "node:test";
import {readKnowledgeExtractionCommand,readKnowledgeExtractionResult,type KnowledgeExtractionSnapshot} from "../knowledge-extraction-policy";
import {createKnowledgeExtractionHandler,requestKnowledgeExtraction,type KnowledgeExtractionDeps} from "./knowledge-extract";
import {studioCommandResponse} from "../command-http";
import {StudioJobError} from "./handlers";
const source="bc200000-0000-4000-8000-000000000001",runId="bc300000-0000-4000-8000-000000000001",requestId="bc500000-0000-4000-8000-000000000001";
const snapshot:KnowledgeExtractionSnapshot={source:{id:source,version:1,title:"Source",url:"https://example.com/source"},mode:"record_text",inputId:"transcript",startUnit:1,unitCount:1,focus:"Methods",fingerprint:"synthetic",
 coverage:{totalUnits:3,selectedUnits:1,totalCharacters:4500},units:[{id:"record_text:transcript:1",unitIndex:1,text:"🙂 Café e\u0301. Saved claim.",startChar:2000,endChar:2025,startSeconds:null,endSeconds:null}]};
const result={findings:[{kind:"claim" as const,unitId:snapshot.units[0].id,statement:"The source asserts a claim.",suggestedTopic:"Methods",quote:"Café"}]};
const enqueue={action:"enqueue",requestId,sourceId:source,expectedVersion:1,mode:"record_text",inputId:"transcript",startUnit:1,unitCount:1,focus:"Methods",confirmPaid:true};
test("extraction commands bind a bounded explicit source range and a separate pending application",()=>{
 assert.equal(readKnowledgeExtractionCommand(enqueue).action,"enqueue");
 for(const patch of [{confirmPaid:false},{mode:"youtube_download"},{inputId:"secret"},{unitCount:9},{startUnit:-1},{expectedVersion:0},{mode:"upload_transcript",inputId:"foreign"}])assert.throws(()=>readKnowledgeExtractionCommand({...enqueue,...patch}));
 const apply={action:"apply",requestId,reviewId:runId,expectedVersion:1,findingIndexes:[1,0],confirmPending:true};
 const command=readKnowledgeExtractionCommand(apply);assert.equal(command.action,"apply");if(command.action==="apply")assert.deepEqual(command.findingIndexes,[0,1]);
 for(const patch of [{confirmPending:false},{findingIndexes:[]},{findingIndexes:[0,0]},{findingIndexes:[10]},{expectedVersion:2.5},{action:"approve"}])assert.throws(()=>readKnowledgeExtractionCommand({...apply,...patch}));
});
test("findings cite only selected units and exact unnormalized quotes; empty results are valid",()=>{
 assert.deepEqual(readKnowledgeExtractionResult(result,snapshot),result);assert.deepEqual(readKnowledgeExtractionResult({findings:[]},snapshot),{findings:[]});
 for(const patch of [{unitId:"foreign"},{quote:"Cafe\u0301"},{quote:"café"},{quote:""},{statement:"x".repeat(1001)},{suggestedTopic:""},{kind:"approved_fact"}])assert.throws(()=>readKnowledgeExtractionResult({findings:[{...result.findings[0],...patch}]},snapshot));
 assert.throws(()=>readKnowledgeExtractionResult({findings:[result.findings[0],result.findings[0]]},snapshot));
 assert.throws(()=>readKnowledgeExtractionResult({findings:Array(11).fill(result.findings[0])},snapshot));
 const denseSnapshot={...snapshot,units:[{...snapshot.units[0],text:"漢".repeat(600)}]};
 const denseFindings=Array.from({length:10},(_,i)=>({...result.findings[0],statement:String(i)+"漢".repeat(999),suggestedTopic:"漢".repeat(120),quote:"漢".repeat(600)}));
 assert.throws(()=>readKnowledgeExtractionResult({findings:denseFindings},denseSnapshot));
});
test("provider receives bounded source units with no tools or media and returns metered proposals",async()=>{
 let sent:any;
 const output=await requestKnowledgeExtraction(snapshot,"sk-synthetic",new AbortController().signal,async(_url,init)=>{
  sent=JSON.parse(String(init?.body));return Response.json({id:"resp_extract",status:"completed",model:"gpt-6-luna",service_tier:"default",usage:{input_tokens:1000,output_tokens:1000,input_tokens_details:{cached_tokens:0,cache_write_tokens:0}},output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(result)}]}]});
 });
 assert.equal(sent.max_output_tokens,6000);assert.equal(sent.store,false);assert.deepEqual(sent.tools,[]);assert.match(sent.instructions,/untrusted data/);assert.match(sent.instructions,/empty findings is valid/);assert.deepEqual(JSON.parse(sent.input),snapshot);assert.equal(output.costMicros,600);assert.deepEqual(output.result,result);
});
test("lost provider/persistence outcomes retain the hold, block resend, and never apply findings",async()=>{
 for(const mode of ["success","response_lost","persist_failed","abort"]){
  let calls=0,saved=false,started=false;const rpcNames:string[]=[];const controller=new AbortController();
  const deps:KnowledgeExtractionDeps={db:fixtureDb(async<T>(p:string,init?:RequestInit):Promise<T>=>{
   if(p.startsWith("studio_idea_reviews"))return [{snapshot,result:saved?result:null,model:"gpt-6-luna",prompt_version:"studio.knowledge-extract.v1",workflow:"knowledge_extract"}] as T;
   if(p.startsWith("studio_location_ai_credentials"))return [{}] as T;rpcNames.push(p);const body=JSON.parse(String(init?.body));assert.equal(body.p_lease_token,"lease");
   if(p.endsWith("studio_begin_text_run_attempt")){if(started)return {outcome:"uncertain"} as T;started=true;return {outcome:"started",attempt_id:"attempt"} as T;}
   if(p.endsWith("studio_finish_text_run_attempt")){if(mode==="persist_failed")throw new Error("Persistence failure");saved=true;}return true as T;
  }),decryptKey:()=>"sk-synthetic",generate:async()=>{calls++;if(mode==="response_lost")throw new Error("Lost response");if(mode==="abort")controller.abort();return {result,providerResponseId:"resp_extract",inputTokens:1000,outputTokens:1000,costMicros:600,rateVersion:"gpt-6-luna-standard-2026-10-23"};}};
  const handler=createKnowledgeExtractionHandler(deps);const job={id:"job",location_id:"workspace",kind:"studio.knowledge_extract",payload:{reviewId:runId},lease_token:"lease",attempts:1,max_attempts:5};const context={workerId:"worker",signal:controller.signal};
  if(mode==="success"){await handler(job,context);await handler(job,context);}else{await assert.rejects(handler(job,context),(e:StudioJobError)=>e.code==="ai_outcome_uncertain"&&!e.retryable);if(mode!=="abort")await assert.rejects(handler(job,context));}
  assert.equal(calls,1);assert.ok(!rpcNames.some(n=>n.includes("apply_knowledge")));
 }
});
test("extraction/application share the same-origin bounded command boundary",async()=>{
 let writes=0;const deps={profile:async()=>({origin:"https://substo.com"}),parse:readKnowledgeExtractionCommand,execute:async()=>{writes++;return {};}};
 const req=(body:unknown,origin="https://substo.com")=>new Request("https://substo.com/studio/extract",{method:"POST",headers:{origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
 assert.equal((await studioCommandResponse(req(enqueue,"https://estio.co"),deps)).status,403);
 assert.equal((await studioCommandResponse(req({...enqueue,confirmPaid:false}),deps)).status,400);
 assert.equal(writes,0);assert.equal((await studioCommandResponse(req(enqueue),deps)).status,200);assert.equal(writes,1);
});
