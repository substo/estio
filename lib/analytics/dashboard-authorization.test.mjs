import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./dashboard.ts", import.meta.url), "utf8");

test("analytics dashboard requires a location admin before querying metrics", () => {
  const authorization = source.indexOf("const isLocationAdmin = await verifyUserIsLocationAdmin");
  const firstMetricsQuery = source.indexOf("db.$queryRaw");

  assert.notEqual(authorization, -1);
  assert.notEqual(firstMetricsQuery, -1);
  assert.ok(authorization < firstMetricsQuery);
});

test("analytics entity joins preserve the event location boundary", () => {
  assert.match(source, /p\."locationId" = e\."locationId"/);
  assert.match(source, /c\."locationId" = e\."locationId"/);
});

test("recent conversions honor the selected date range", () => {
  const recentConversionsQuery = source.slice(source.lastIndexOf('SELECT\n        e."occurredAt"'));
  assert.match(recentConversionsQuery, /e\."occurredAt" >= \$\{startDate\}/);
});

test("public traffic metrics do not count admin navigation", () => {
  assert.doesNotMatch(source, /"eventName" IN \('page_view', 'admin_page_view'\)/);
  assert.match(source, /"eventName" = 'page_view'\) AS "pageViews"/);
});
