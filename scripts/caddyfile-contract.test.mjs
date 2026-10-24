import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../Caddyfile", import.meta.url), "utf8");

/** Return top-level site blocks keyed by their address line. */
function siteBlocks(caddyfile) {
  const blocks = new Map();
  let depth = 0;
  let current = null;
  for (const line of caddyfile.split("\n")) {
    const trimmed = line.replace(/#.*$/, "").trim();
    if (depth === 0 && trimmed.endsWith("{")) {
      current = trimmed.slice(0, -1).trim();
      blocks.set(current, []);
    } else if (current && depth > 0) {
      blocks.get(current).push(trimmed);
    }
    depth += (trimmed.match(/{/g) ?? []).length - (trimmed.match(/}/g) ?? []).length;
    if (depth === 0) {
      if (current) blocks.get(current).pop();
      current = null;
    }
  }
  return blocks;
}

/** Mirror the port rewrite performed by deploy-local-build.sh. */
function renderForPort(caddyfile, port) {
  return caddyfile.replace(/localhost:(3001|3002)/g, `localhost:${port}`);
}

test("substo.com apex has an explicit site block proxying to the app", () => {
  const block = siteBlocks(source).get("substo.com");
  assert.ok(block, "substo.com site block is missing");
  assert.ok(block.some((line) => /^reverse_proxy localhost:300[12]$/.test(line)));
  assert.ok(!block.some((line) => line.startsWith("on_demand")), "apex must not depend on the ask gate");
});

test("www.substo.com is left to its external DNS owner", () => {
  for (const address of siteBlocks(source).keys()) {
    assert.ok(!/(^|[\s,])(https?:\/\/)?www\.substo\.com\b/.test(address), `unexpected ${address}`);
  }
});

test("Estio hosts remain unchanged", () => {
  const blocks = siteBlocks(source);
  assert.ok(blocks.get("estio.co").includes("reverse_proxy localhost:3002"));
  assert.deepEqual(blocks.get("www.estio.co").filter(Boolean), ["redir https://estio.co{uri} 308"]);
  assert.ok(blocks.has(":443"));
});

test("deploy port rendering moves every upstream, including the apex, to the target slot", () => {
  for (const port of [3001, 3002]) {
    const rendered = renderForPort(source, port);
    const other = port === 3001 ? 3002 : 3001;
    assert.ok(!rendered.includes(`localhost:${other}`));
    assert.ok(siteBlocks(rendered).get("substo.com").includes(`reverse_proxy localhost:${port}`));
  }
});
