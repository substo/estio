import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";
import clsx from "clsx";
import ts from "typescript";
import { isSubstoCrmPage } from "@/lib/auth/substo-crm-policy";

function navigation(realm: "estio" | "substo", pathname = "/admin") {
  const passthrough = ({ children }: any) => React.createElement(React.Fragment, null, children);
  const deps: Record<string, any> = {
    "react": React,
    "./crm-realm": { useCrmRealm: () => realm },
    "@/lib/auth/substo-crm-policy": { isSubstoCrmPage },
    "next/link": { default: ({ children, href }: any) => React.createElement("a", { href }, children) },
    "next/navigation": { usePathname: () => pathname },
    "lucide-react": icons, "clsx": { default: clsx },
    "@/components/ui/button": { Button: ({ asChild, children }: any) => asChild ? children : React.createElement("button", null, children) },
    "@/components/ui/sheet": { SheetClose: passthrough },
    "@/components/ui/tooltip": Object.fromEntries(["Tooltip", "TooltipContent", "TooltipProvider", "TooltipTrigger"].map(name => [name, passthrough])),
  };
  const module = { exports: {} as any };
  const code = ts.transpileModule(fs.readFileSync("app/(main)/admin/_components/admin-navigation.tsx", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, React, require: (name: string) => { assert.ok(name in deps, name); return { __esModule: true, ...deps[name] }; } });
  return module.exports;
}

test("Substo previews every shared CRM capability without links to unready routes in any sidebar mode", () => {
  const api = navigation("substo");
  for (const props of [{ variant: "desktop" }, { variant: "desktop", collapsed: true }, { variant: "mobile" }] as Array<{ variant: "desktop" | "mobile"; collapsed?: boolean }>) {
    const html = renderToStaticMarkup(React.createElement(api.AdminNavigationGroups, props));
    for (const group of api.ADMIN_NAV_GROUPS) for (const item of group.items) {
      assert.ok(html.includes(item.label), item.label);
      if (!isSubstoCrmPage(item.href)) assert.ok(!html.includes(`href="${item.href}"`), item.href);
    }
    assert.match(html, /aria-disabled="true"/);
    assert.match(html, /setup pending/);
    assert.match(html, /href="\/admin\/contacts"/);
  }
});
test("Estio keeps every existing live menu destination and no setup-pending labels", () => {
  const api = navigation("estio");
  const html = renderToStaticMarkup(React.createElement(api.AdminNavigationGroups));
  for (const group of api.ADMIN_NAV_GROUPS) for (const item of group.items) assert.ok(html.includes(`href="${item.href}"`));
  assert.doesNotMatch(html, /setup pending|aria-disabled/);
});

test("Website tools share one sidebar group and Substo members do not see admin-only links", () => {
  const api = navigation("substo");
  const group = api.ADMIN_NAV_GROUPS.find((entry: { label: string }) => entry.label === "Website");
  assert.deepEqual(Array.from(group.items, (item: { label: string }) => item.label), [
    "Publishing", "Homepage", "Pages", "Blog", "Menus", "Appearance",
  ]);
  const member = renderToStaticMarkup(React.createElement(api.AdminNavigationGroups, { locationAdmin: false }));
  assert.match(member, /href="\/admin\/content\/website"/);
  assert.doesNotMatch(member, /href="\/admin\/content\/website\/(navigation|appearance)"/);
});


test("Website disclosure starts closed outside Website and expanded on its child routes", () => {
  for (const [path, expanded] of [["/admin", false], ["/admin/content/posts", true]] as const) {
    const api = navigation("estio", path);
    const html = renderToStaticMarkup(React.createElement(api.AdminNavigationGroups));
    assert.match(html, new RegExp(`<button[^>]*aria-expanded="${expanded}"[^>]*>[\\s\\S]*?<span[^>]*>Website</span>`));
  }
});
