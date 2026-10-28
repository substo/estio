import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyStudioCopy } from "./merge-verification";
const tables=Array.from({length:53},(_,i)=>({table:'studio_'+String.fromCharCode(97+Math.floor(i/26))+String.fromCharCode(97+i%26),count:i,digest:'a'.repeat(32)}));
const evidence={tables,foreign_keys:89,mapped_locations:2};
function fixture(mismatch=false){let calls=0;return {get calls(){return calls;},db:{$queryRaw:async(q:any)=>{calls++;const text=q.sql??q.join('');assert.match(text,/^select /);if(text.includes('pg_tables'))return tables.map(t=>({tablename:t.table}));const table=tables.find(t=>text.includes('studio.'+t.table))!;return [{count:table.count+(mismatch?1:0),digest:table.digest}];}} as any};}
test('receipt verification rechecks all target counts and digests using read-only SQL',async()=>{const f=fixture();await verifyStudioCopy(f.db,evidence);assert.equal(f.calls,54);});
test('partial inventory, mismatched data and malformed names fail before activation',async()=>{
 for(const value of [{...evidence,tables:tables.slice(1)},{...evidence,foreign_keys:88},{...evidence,mapped_locations:1},{...evidence,tables:[{...tables[0],table:'invalid-name'},...tables.slice(1)]}])await assert.rejects(verifyStudioCopy(fixture().db,value));
 await assert.rejects(verifyStudioCopy(fixture(true).db,evidence),/Target differs/);
});
