import assert from 'node:assert/strict';
import test from 'node:test';
import { propertyImportUsage } from './import-usage-policy';
const input={locationId:'business-a',stage:'VISION',provider:'google_gemini',model:'fixture',inputTokens:100,outputTokens:200};
test('import usage binds its canonical Location and preserves returned provider tokens',()=>{const value=propertyImportUsage(input);assert.equal(value.locationId,'business-a');assert.equal(value.action,'vision');assert.equal(value.inputTokens,100);assert.equal(value.outputTokens,200);assert.equal(value.metadata?.costStatus,'estimated');assert.throws(()=>propertyImportUsage({...input,locationId:''}));});
test('missing or invalid provider usage is marked unavailable, never invented',()=>{for(const patch of [{inputTokens:undefined},{outputTokens:NaN},{inputTokens:-1}]){const value=propertyImportUsage({...input,...patch});assert.equal(value.metadata?.costStatus,'unavailable');assert.equal(value.inputTokens,0);assert.equal(value.outputTokens,0);}});
test('subscription funding attribution survives import metering',()=>{const value=propertyImportUsage({...input,provider:'chatgpt_subscription',fundingScope:'user_chatgpt',executionMode:'interactive'});assert.equal(value.fundingScope,'user_chatgpt');assert.equal(value.executionMode,'interactive');});
