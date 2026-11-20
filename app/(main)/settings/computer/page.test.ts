import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import Link from "next/link";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";
import React, { Fragment, Suspense, createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import { StudioTenantProvider, useStudioTenantHeaders } from "@/app/(main)/studio/_components/studio-tenant-context";
import type { StudioDeviceSummary } from "@/lib/studio/devices";
import { defaultDeviceConfig } from "@/lib/studio/devices-policy";
import { visibleSettingsSections } from "../_components/sections";
import { CompanionSettings } from "./companion-settings";

function loadRoute<Props>(url: URL, dependencies: Record<string, unknown>) {
  const module: { exports: { default?: (props: Props) => Promise<ReactNode> } } = { exports: {} };
  const source = ts.transpileModule(readFileSync(url, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  runInNewContext(source, {
    exports: module.exports,
    require(name: string) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected route dependency: ${name}`);
      return dependencies[name];
    },
  });
  assert.ok(module.exports.default);
  return module.exports.default;
}

type Case = {
  app: "estio" | "substo";
  role: "ADMIN" | "MEMBER";
  devices: StudioDeviceSummary[];
  code?: string;
};
const offline: StudioDeviceSummary = {
  id: "fixture-mac", name: "Fixture Mac", platform: "macOS", created_at: "2026-10-01T00:00:00Z",
  revoked_at: null, last_seen_at: "2026-10-01T00:00:00Z", release: null, started_at: null,
  allowed_kinds: [], capabilities: {}, online: false, busy: false, status: "offline", processingEnabled: true, paused: false,
  config: { version: 0, value: defaultDeviceConfig, appliedVersion: 0, status: "none", report: {} },
  commands: [], research: { online: false, ready: false, providers: [], reason: "Mac is offline" },
};
const router: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

function TenantProbe() {
  return createElement("output", {}, useStudioTenantHeaders()["X-Studio-Tenant"]);
}

async function renderSettings({ app, role, devices, code }: Case) {
  const locationId = `${app}-fixture-location`;
  const requireSettingsContext = async () => ({
    app, locationId, tenantHost: false, access: { locationId, locationName: "Fixture location", role },
  });
  const shared = { "react/jsx-runtime": jsx, "./_components/context": { requireSettingsContext } };
  const layout = loadRoute<{ children: ReactNode }>(new URL("../layout.tsx", import.meta.url), {
    ...shared,
    react: { Suspense },
    "next/link": Link,
    "@/components/ui/button": { Button: () => null },
    "@/app/(main)/studio/_components/studio-tenant-context": { StudioTenantProvider },
    "./_components/sections": { visibleSettingsSections },
    "./_components/settings-nav": { SettingsBackLink: () => null, SettingsNav: () => null },
  });
  const page = loadRoute<{ searchParams: Promise<{ code?: string }> }>(new URL("./page.tsx", import.meta.url), {
    "react/jsx-runtime": jsx,
    "next/navigation": { notFound: () => assert.fail("Unexpected notFound") },
    "@/lib/platform/profile": { getPlatformProfile: async () => ({ origin: `https://${app}.example` }) },
    "@/lib/studio/devices": {
      getStudioDevices: async (id: string) => {
        assert.equal(id, locationId);
        return { canManage: role === "ADMIN", devices };
      },
    },
    "../_components/context": { requireSettingsContext },
    "./companion-settings": { CompanionSettings },
  });
  const content = await page({ searchParams: Promise.resolve({ code }) });
  const shell = await layout({ children: createElement(Fragment, null, content, createElement(TenantProbe)) });
  // tsx follows the repository's JSX preserve option for imported client components.
  const previous = Object.getOwnPropertyDescriptor(globalThis, "React");
  Object.defineProperty(globalThis, "React", { value: React, configurable: true });
  try {
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, shell));
    assert.ok(html.includes(`<output>${locationId}</output>`), "active Location reached the Studio command context");
    return html;
  } finally {
    if (previous) Object.defineProperty(globalThis, "React", previous);
    else Reflect.deleteProperty(globalThis, "React");
  }
}

test("Connected computer renders an empty Location and a pairing link through Settings", async () => {
  const empty = await renderSettings({ app: "substo", role: "ADMIN", devices: [] });
  assert.match(empty, /No computers connected yet/);
  assert.match(empty, /Pairing code/);
  const pairing = await renderSettings({ app: "substo", role: "ADMIN", devices: [], code: "TEST-1234" });
  assert.match(pairing, /TEST-1234/);
});

test("Connected computer renders offline and never-seen Macs with processing controls", async () => {
  const waiting = { ...offline, id: "waiting", last_seen_at: null, processingEnabled: false };
  const html = await renderSettings({ app: "estio", role: "ADMIN", devices: [offline, waiting] });
  assert.match(html, /Companion not running/);
  assert.match(html, /nothing will run until the Studio companion is running/);
  assert.match(html, /Paired, but the companion has never connected/);
  assert.match(html, /Turn processing on/);
  assert.match(html, /Turn processing off/);
});

test("Connected computer is read-only for Location members", async () => {
  const html = await renderSettings({ app: "substo", role: "MEMBER", devices: [offline] });
  assert.match(html, /Ask a Business admin to change settings/);
  assert.doesNotMatch(html, /Turn processing off|>Revoke<|>Save setup</);
});

test("Settings lists Website for people who can open it", () => {
  const showsWebsite = (app: Case["app"], role: Case["role"]) =>
    visibleSettingsSections(app, role, false).some(section => section.href === "/settings/website");
  assert.equal(showsWebsite("substo", "MEMBER"), false);
  assert.equal(showsWebsite("substo", "ADMIN"), true);
  assert.equal(showsWebsite("estio", "MEMBER"), true);
});
