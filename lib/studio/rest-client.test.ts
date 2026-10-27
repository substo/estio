import assert from "node:assert/strict";
import test from "node:test";
import { isProviderRestrictionResponse, isStudioProviderUnavailable, requestStudioRest, requestStudioRestAll, resetStudioProviderBackoff, STUDIO_PROVIDER_BACKOFF_MS, StudioRestError, studioProviderRestricted, studioUnavailableResponse } from "./rest-client";

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

const restricted = '{"message":"Service for this project is restricted due to the following violations: exceed_egress_quota. Please visit the dashboard."}';
test("only an explicit provider restriction or pause is classified as Studio unavailable", () => {
  assert.equal(isProviderRestrictionResponse(402, JSON.parse(restricted).message), true);
  assert.equal(isProviderRestrictionResponse(503, "Project is paused"), true);
  for (const [status, message] of [[402, "Payment required"], [402, ""], [503, "upstream connect error"], [500, "restricted"], [403, "quota"], [429, "quota exceeded"]] as const) {
    assert.equal(isProviderRestrictionResponse(status, message), false, `${status} ${message}`);
  }
});

test("a restricted project backs off: later calls fail fast without reaching the provider, then probe again", async () => {
  resetStudioProviderBackoff();
  const config = { projectUrl: "https://restricted.supabase.co", serviceRoleKey: "server-key" };
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls += 1; return new Response(restricted, { status: 402 }); };
  const realNow = Date.now;
  try {
    await assert.rejects(requestStudioRest(config, "studio_records", {}, fetcher), (error: unknown) => {
      assert.ok(error instanceof StudioRestError); assert.equal(error.providerRestricted, true); assert.ok(isStudioProviderUnavailable(error));
      assert.doesNotMatch(error.message, /egress|dashboard/); return true;
    });
    assert.equal(studioProviderRestricted(), true);
    await assert.rejects(requestStudioRest(config, "studio_records", {}, fetcher), (error: unknown) => isStudioProviderUnavailable(error));
    assert.equal(calls, 1);
    assert.ok(isStudioProviderUnavailable(new Error("wrapped", { cause: new StudioRestError(402, undefined, true) })));
    const start = realNow();
    Date.now = () => start + STUDIO_PROVIDER_BACKOFF_MS + 1;
    assert.equal(studioProviderRestricted(), false);
    await assert.rejects(requestStudioRest(config, "studio_records", {}, async () => { calls += 1; return new Response("{}", { status: 500 }); }),
      (error: unknown) => error instanceof StudioRestError && !error.providerRestricted);
    assert.equal(calls, 2);
  } finally { Date.now = realNow; resetStudioProviderBackoff(); }
});

test("ordinary failures never trigger the backoff or the unavailable response", async () => {
  resetStudioProviderBackoff();
  const config = { projectUrl: "https://ordinary.supabase.co", serviceRoleKey: "server-key" };
  for (const response of [() => new Response('{"message":"Payment required"}', { status: 402 }), () => new Response("<html>bad gateway</html>", { status: 503 })]) {
    await assert.rejects(requestStudioRest(config, "studio_records", {}, async () => response()), (error: unknown) => !isStudioProviderUnavailable(error));
  }
  assert.equal(studioProviderRestricted(), false);
  const unavailable = studioUnavailableResponse();
  assert.equal(unavailable.status, 503); assert.equal(unavailable.headers.get("Retry-After"), "120");
});
