import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { resolveHostBrand } from "@/lib/auth/host-brand";

test("the public reader independently verifies the exact host before any database access", async () => {
  const code = ts.transpileModule(fs.readFileSync("lib/substo-sites/request.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  for (const host of ["estio.co", "tenant.example.com", "substo.test.attacker.example", "substo.test"]) {
    let reads = 0;
    const deps: Record<string, unknown> = {
      "server-only": {}, "react": { cache: (fn: unknown) => fn }, "next/headers": { headers: async () => new Headers({ host }) }, "@/lib/db": {},
      "@/lib/auth/host-brand": { resolveHostBrand, getHostBrandConfig: () => ({ estioHosts: ["estio.co"], substoHosts: ["substo.test"] }) },
      "./service": { getPublishedWebsite: async () => { reads++; return { slug: "public-brand" }; } },
    };
    const exports: any = {};
    vm.runInNewContext(`(function(require, exports) {${code}\n})`)((name: string) => { assert.ok(name in deps); return deps[name]; }, exports);
    const result = await exports.loadPublicWebsite("public-brand");
    assert.equal(reads, host === "substo.test" ? 1 : 0, host);
    assert.equal(Boolean(result), host === "substo.test", host);
  }
});
