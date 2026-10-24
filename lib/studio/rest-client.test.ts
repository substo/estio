import assert from "node:assert/strict";
import test from "node:test";
import { requestStudioRest, requestStudioRestAll, StudioRestError } from "./rest-client";

test("PostgREST minimal inserts allow empty 201 bodies and requests remain uncached", async () => {
  const fetcher: typeof fetch = async (_url, init) => {
    assert.equal(init?.cache,"no-store");
    assert.equal(new Headers(init?.headers).get("Authorization"),"Bearer server-key");
    return new Response(null,{status:201});
  };
  assert.equal(await requestStudioRest({projectUrl:"https://example.supabase.co",serviceRoleKey:"server-key"},"studio_records",{method:"POST"},fetcher),undefined);
});

test("Lists continue through PostgREST row caps and reject missing reconciliation totals", async () => {
  const offsets: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    const offset = new URL(String(url)).searchParams.get("offset")!;
    offsets.push(offset);
    return offset === "0" ? new Response(JSON.stringify([{id:1},{id:2}]),{headers:{"content-range":"0-1/3"}})
      : new Response(JSON.stringify([{id:3}]),{headers:{"content-range":"2-2/3"}});
  };
  const config = {projectUrl:"https://example.supabase.co",serviceRoleKey:"server-key"};
  assert.deepEqual(await requestStudioRestAll(config,"records",{order:"id.asc"},fetcher),[{id:1},{id:2},{id:3}]);
  assert.deepEqual(offsets,["0","2"]);
  await assert.rejects(requestStudioRestAll(config,"records",{},async () => new Response("[]")),/reconciliation count/);
});

test("Expected DB codes remain classifiable without returning sensitive messages", async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({code:"P0002",message:"sensitive private row details"}),{status:404});
  await assert.rejects(requestStudioRest({projectUrl:"https://example.supabase.co",serviceRoleKey:"server-key"},"rpc/invite",{},fetcher), (error: unknown) => {
    assert.ok(error instanceof StudioRestError); assert.equal(error.code,"P0002"); assert.doesNotMatch(error.message,/sensitive/); return true;
  });
});
