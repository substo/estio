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
import { normalizeSmsRelayPlatform } from "@/lib/sms-relay/device-capabilities";
import { defaultDeviceConfig } from "@/lib/studio/devices-policy";
import { visibleSettingsSections } from "../_components/sections";
import { CompanionSettings } from "./companion-settings";

function loadRoute<Props>(url: URL, dependencies: Record<string, unknown>, exportName = "default") {
  const module: { exports: Record<string, (props: Props) => Promise<ReactNode>> } = { exports: {} };
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
  assert.ok(module.exports[exportName]);
  return module.exports[exportName];
}

type Case = {
  app: "estio" | "substo";
  role: "ADMIN" | "MEMBER";
  devices: StudioDeviceSummary[];
  code?: string;
  type?: "mobile";
  impersonating?: boolean;
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

async function renderSettings({ app, role, devices, code, type, impersonating }: Case) {
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
    "@/app/(main)/studio/_components/studio-shell-data": { getStudioShellData: async () => ({ app }) },
    "./_components/sections": { visibleSettingsSections },
    "./_components/settings-nav": { SettingsShell: ({ children }: { children: ReactNode }) => children },
  });
  let mobileReads = 0;
  const MobileDevices = loadRoute<{ app: Case["app"]; role: Case["role"]; impersonating: boolean }>(new URL("./mobile-devices.tsx", import.meta.url), {
    "react/jsx-runtime": jsx,
    "next/link": Link,
    "@/lib/sms-relay/device-capabilities": { normalizeSmsRelayPlatform },
    "@/components/ui/button": { Button: ({ children }: { children: ReactNode }) => children },
    "./device-status": { DeviceStatus: ({ state }: { state: string }) => state },
    "../integrations/sms-relay/actions": { getSmsRelayDevices: async () => {
      mobileReads++;
      return [
        { id: "android_fixture", label: "Fixture Android", platform: "android", paired: true, status: "online", lastSeenAt: new Date().toISOString() },
        { id: "stale_fixture", label: "Old Android", platform: "android", paired: true, status: "online", lastSeenAt: "2020-01-01T00:00:00Z" },
        { id: "ios_fixture", label: "Fixture iPhone", platform: "ios", paired: true, status: "online" },
      ];
    } },
  }, "MobileDevices");
  const page = loadRoute<{ searchParams: Promise<{ code?: string; type?: "mobile"; from: "crm" }> }>(new URL("./page.tsx", import.meta.url), {
    "react/jsx-runtime": jsx,
    "next/navigation": { notFound: () => assert.fail("Unexpected notFound") },
    "next/link": Link,
    "@clerk/nextjs/server": { auth: async () => ({ actor: impersonating ? {} : undefined }) },
    "@/components/ui/button": { Button: ({ children }: { children: ReactNode }) => children },
    "./mobile-devices": { MobileDevices },
    "@/lib/platform/profile": { getPlatformProfile: async () => ({ origin: `https://${app}.example` }) },
    "@/lib/studio/devices": {
      getStudioDevices: async (id: string) => {
        assert.ok(type !== "mobile" || code, "mobile view skips Mac inventory");
        assert.equal(id, locationId);
        return { canManage: role === "ADMIN", devices };
      },
    },
    "../_components/context": { requireSettingsContext },
    "./companion-settings": { CompanionSettings },
  });
  const route = await page({ searchParams: Promise.resolve({ code, type, from: "crm" }) });
  assert.ok(React.isValidElement<{ children: ReactNode[] }>(route));
  // Resolve the nested server component before rendering through React's synchronous SSR test runtime.
  const children = await Promise.all(route.props.children.map(child => React.isValidElement<Parameters<typeof MobileDevices>[0]>(child)
    && child.type === MobileDevices ? MobileDevices(child.props) : child));
  assert.equal(mobileReads, type === "mobile" && !code && app === "estio" && role === "ADMIN" && !impersonating ? 1 : 0);
  const content = React.cloneElement(route, { children });
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

test("Devices renders an empty Location and a pairing link through Settings", async () => {
  const empty = await renderSettings({ app: "substo", role: "ADMIN", devices: [] });
  assert.match(empty, />Devices<\/h1>/);
  assert.match(empty, /No computers connected yet/);
  assert.match(empty, /Pairing code/);
  const pairing = await renderSettings({ app: "substo", role: "ADMIN", devices: [], code: "TEST-1234" });
  assert.match(pairing, /TEST-1234/);
});

test("Devices groups online and offline Macs by connectivity, even if processing is paused", async () => {
  const waiting: StudioDeviceSummary = { ...offline, id: "waiting", last_seen_at: null, processingEnabled: false };
  const online: StudioDeviceSummary = { ...offline, id: "online", name: "Online Mac", online: true, status: "paused", paused: true };
  const html = await renderSettings({ app: "estio", role: "ADMIN", devices: [offline, waiting, online] });
  assert.match(html, /Online \(1\).*Offline \(2\)/);
  assert.match(html, /Paused/);
  assert.match(html, /No recent heartbeat/);
  assert.match(html, /work waits until the Studio companion reconnects/);
  assert.match(html, /Paired, but the companion has never connected/);
  assert.match(html, /Turn processing on/);
  assert.match(html, /Turn processing off/);
  assert.match(html, /id="computer-fixture-mac"/);
  assert.equal([...html.matchAll(/>Remove Mac</g)].length, 3);
});

test("Devices is read-only for Location members", async () => {
  const html = await renderSettings({ app: "substo", role: "MEMBER", devices: [offline] });
  assert.match(html, /Ask a Business admin to change settings/);
  assert.doesNotMatch(html, /Turn processing off|>Remove Mac<|>Save setup</);
});

test("Devices shows bounded recent Mac work, throughput, memory pressure and a slow hint", async () => {
  const now = Date.now();
  const device: StudioDeviceSummary = { ...offline, online: true, capabilities: { metrics: { version: 1, memory: { swapUsedMb: 2560, freePercent: 7.4 }, recent: [
    { feature: "voice_preview", status: "succeeded", outcome: "succeeded", startedAtMs: now - 42_000, durationMs: 42_000, typicalDurationMs: 40_000, unit: "audio_seconds", units: 4, ratePerSecond: 0.1 },
    { feature: "make_video", status: "running", outcome: "running", startedAtMs: now - 400_000, durationMs: 400_000, typicalDurationMs: 100_000, slow: true, stages: { prepare: 12_000 } },
  ] } } };
  const html = await renderSettings({ app: "substo", role: "ADMIN", devices: [device] });
  assert.match(html, /Recent work on this Mac/);
  assert.match(html, /Voice preview/);
  assert.match(html, /0\.1 audio s\/s/);
  assert.match(html, /10\.0× real-time factor/);
  assert.match(html, /High memory pressure/);
  assert.match(html, /Running longer than usual/);
  assert.match(html, /prepare 12 s/);
});


test("The mobile filter preserves the originating product and limits the relay inventory to Estio admins", async () => {
  const admin = await renderSettings({ app: "estio", role: "ADMIN", devices: [], type: "mobile" });
  assert.match(admin, /Fixture Android<\/span>Online/);
  assert.match(admin, /Old Android<\/span>Offline/);
  assert.match(admin, /Fixture iPhone<\/span>Approval required/);
  assert.match(admin, /Manage mobile devices/);
  assert.match(admin, /aria-current="page" href="\/settings\/computer\?type=mobile&amp;from=crm"/);
  for (const [app, role, impersonating] of [["estio", "MEMBER", false], ["estio", "ADMIN", true], ["substo", "ADMIN", false]] as const) {
    const html = await renderSettings({ app, role, impersonating, devices: [], type: "mobile" });
    assert.doesNotMatch(html, /Fixture Android|Manage mobile devices/);
  }
});

test("A Mac pairing code opens Computers when the mobile filter is also present", async () => {
  const html = await renderSettings({ app: "substo", role: "ADMIN", devices: [], type: "mobile", code: "TEST-1234" });
  assert.match(html, /TEST-1234/);
  assert.match(html, /aria-current="page" href="\/settings\/computer\?from=crm"/);
});
