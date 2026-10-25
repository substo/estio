import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const read = (file: string) => fs.readFileSync(file, "utf8");

/** Transpile a client module and evaluate it with stub dependencies, returning its element tree. */
function uiModule(file: string, dependencies: Record<string, any>) {
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: any = {};
  vm.runInNewContext(`(function(require, exports) {${code}\n})`)((name: string) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx, Fragment: "fragment" };
    return dependencies[name] ?? {};
  }, exports);
  return exports;
}

function walk(tree: any, visit: (node: any) => void) {
  if (!tree || typeof tree !== "object") return;
  if ((typeof tree.type === "string" || typeof tree.type === "function") && tree.props) visit(tree);
  for (const child of Object.values(tree)) walk(child, visit);
}

const widgets = {
  Sheet: function Sheet() {}, SheetContent: function SheetContent() {}, SheetHeader: function SheetHeader() {}, SheetTitle: function SheetTitle() {}, SheetTrigger: function SheetTrigger() {},
  ModeToggle: function ModeToggle() {}, AICostBadge: function AICostBadge() {}, AdminNotificationBell: function AdminNotificationBell() {},
  ProductSwitcher: function ProductSwitcher() {}, TenantHeaderSelector: function TenantHeaderSelector() {}, UserProfile: function UserProfile() {},
  AdminNavigationGroups: function AdminNavigationGroups() {}, QuickAssistStartButton: function QuickAssistStartButton() {},
};

function loadHeader() {
  return uiModule("components/app-shell/app-header.tsx", {
    "@radix-ui/react-icons": { HamburgerMenuIcon: function HamburgerMenuIcon() {} },
    "next/link": { __esModule: true, default: "a" },
    "@/config": { __esModule: true, default: { auth: { enabled: true } } },
    "@/components/mode-toggle": { __esModule: true, default: widgets.ModeToggle },
    "@/components/ai-cost-badge": { AICostBadge: widgets.AICostBadge },
    "@/components/notifications/admin-notification-bell": { AdminNotificationBell: widgets.AdminNotificationBell },
    "@/components/product-switcher": { ProductSwitcher: widgets.ProductSwitcher },
    "@/components/tenant-header-selector": { TenantHeaderSelector: widgets.TenantHeaderSelector },
    "@/components/ui/sheet": { Sheet: widgets.Sheet, SheetContent: widgets.SheetContent, SheetHeader: widgets.SheetHeader, SheetTitle: widgets.SheetTitle, SheetTrigger: widgets.SheetTrigger },
    "@/components/user-profile": { UserProfile: widgets.UserProfile },
    "@/app/(main)/admin/_components/admin-navigation": { AdminNavigationGroups: widgets.AdminNavigationGroups },
    "@/app/(main)/admin/viewings/sessions/_components/quick-assist-start-button": { QuickAssistStartButton: widgets.QuickAssistStartButton },
    "@/lib/branding/app-identity": { appIdentity: (app: string) => ({ name: app === "substo" ? "Substo" : "Estio" }) },
    "@/lib/viewings/sessions/types": { VIEWING_SESSION_MODES: { assistantLiveTranslate: "live" }, VIEWING_SESSION_KINDS: { twoWayInterpreter: "interpreter" } },
  });
}

/** The header's items in document order, plus the classes that decide its size and position. */
function describeHeader(tree: any) {
  const items: string[] = [];
  const layout: string[] = [];
  walk(tree, (node) => {
    if (typeof node.type === "function") items.push(node.type.name + (node.props.label ? `:${node.props.label}` : ""));
    if (typeof node.props?.className === "string") layout.push(`${typeof node.type === "string" ? node.type : node.type.name}.${node.props.className}`);
  });
  return { items, layout };
}

function renderHeader(app: "estio" | "substo", product: "crm" | "studio") {
  const { AppHeader } = loadHeader();
  const locations = [{ id: "a", name: "Agency A" }, { id: "b", name: "Agency B" }];
  const tree = AppHeader({
    app, product, activeLocationId: "a", locations, platformLoginLocations: null, canViewAiUsage: true,
    productConfig: { homeHref: product === "crm" ? "/admin" : "/studio", targets: { crm: { href: "/admin" }, studio: { href: "/studio" } }, navGroups: product === "crm" ? undefined : [] },
  });
  return { tree, ...describeHeader(tree) };
}

test("AppHeader renders the same items, order and sizes for CRM and Studio in each app", () => {
  for (const app of ["estio", "substo"] as const) {
    const crm = renderHeader(app, "crm");
    const studio = renderHeader(app, "studio");
    assert.equal(crm.tree.type, "header");
    assert.deepEqual(studio.items, crm.items);
    assert.deepEqual(studio.layout, crm.layout);
    const expected = [
      ...(app === "estio" ? ["QuickAssistStartButton:Live Assist"] : []),
      "AdminNotificationBell", "AICostBadge", "UserProfile", "ModeToggle",
    ];
    const rightCluster = crm.items.slice(crm.items.indexOf("TenantHeaderSelector") + 1);
    assert.deepEqual(rightCluster, expected);
    const mobileMenu = crm.items.slice(0, crm.items.indexOf("TenantHeaderSelector"));
    assert.deepEqual(mobileMenu.filter((item) => !/^(Sheet|HamburgerMenuIcon)/.test(item)), [
      "ModeToggle", ...(app === "estio" ? ["QuickAssistStartButton:Start Live Assist session"] : []), "ProductSwitcher", "AdminNavigationGroups",
    ]);
  }
});

test("AppHeader binds the tenant selector and product switch to the rendered product", () => {
  for (const product of ["crm", "studio"] as const) {
    const { tree } = renderHeader("substo", product);
    const props: Record<string, any> = {};
    walk(tree, (node) => { if (typeof node.type === "function") props[node.type.name] = node.props; });
    assert.equal(props.TenantHeaderSelector.product, product);
    assert.equal(props.TenantHeaderSelector.activeLocationId, "a");
    assert.equal(props.ProductSwitcher.active, product);
  }
});

test("tenant widgets wait for a tenant and AI spend keeps a fixed slot for location admins only", () => {
  const { AppHeader } = loadHeader();
  const productConfig = { homeHref: "/studio", targets: { crm: { href: "/admin" }, studio: { href: "/studio" } }, navGroups: [] };
  const names = (overrides: Record<string, unknown>) => describeHeader(AppHeader({ app: "substo", product: "studio", activeLocationId: "a", locations: [], platformLoginLocations: null, canViewAiUsage: true, productConfig, ...overrides })).items;
  assert.deepEqual(names({ activeLocationId: null }).filter((item) => /Bell|AICost/.test(item)), []);
  assert.deepEqual(names({ canViewAiUsage: false }).filter((item) => /Bell|AICost/.test(item)), ["AdminNotificationBell"]);
  const source = read("components/app-shell/app-header.tsx");
  assert.match(source, /AI_USAGE_SLOT_CLASS = "hidden min-w-\[13rem\] justify-end sm:flex"/);
  assert.match(read("components/ai-cost-badge.tsx"), /h-8 w-\[13rem\][^"]*animate-pulse/);
  assert.match(read("components/mode-toggle.tsx"), /<Skeleton className="w-10 h-10"\/>/);
});

test("CRM, Studio and brand pages all render the one shared shell", () => {
  assert.match(read("app/(main)/admin/layout.tsx"), /<AppShell product="crm" \{\.\.\.shell\}>/);
  assert.match(read("app/(main)/studio/(tenant)/layout.tsx"), /<AppShell product="studio" \{\.\.\.shell\}/);
  assert.match(read("app/(main)/studio/select/page.tsx"), /<AppShell product="studio" \{\.\.\.shell\}>/);
  assert.match(read("app/(main)/brand/team/page.tsx"), /<AppShell product="studio" \{\.\.\.shell\}/);
  assert.match(read("app/(main)/brand/settings/page.tsx"), /<AppShell product="studio" \{\.\.\.shell\}/);
  for (const retired of [
    "app/(main)/admin/_components/admin-shell-layout.tsx",
    "app/(main)/admin/_components/dashbord-top-nav.tsx",
    "app/(main)/admin/_components/dashboard-side-bar.tsx",
    "app/(main)/admin/_components/admin-product-switcher.tsx",
    "app/(main)/studio/_components/studio-shell.tsx",
  ]) assert.equal(fs.existsSync(retired), false, retired);
  const shell = read("components/app-shell/app-shell.tsx");
  assert.match(shell, /<AppHeader/);
  assert.match(shell, /<AppSidebar/);
  // Both products read their header data through the one tenant-derived builder.
  assert.match(read("app/(main)/admin/layout.tsx"), /getAppShellData\(/);
  assert.match(read("app/(main)/studio/_components/studio-shell-data.ts"), /getAppShellData\(/);
});

function sources(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) return sources(file);
    return /\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) ? [file] : [];
  });
}

test("exactly one header implementation exists across the CRM and Studio shells", () => {
  const shellFiles = [
    ...sources("components/app-shell"),
    ...sources("app/(main)/admin/_components"),
    ...sources("app/(main)/studio/_components"),
    "app/(main)/admin/layout.tsx", "app/(main)/studio/layout.tsx", "app/(main)/studio/(tenant)/layout.tsx", "app/(main)/brand/layout.tsx",
  ];
  const withHeader = shellFiles.filter((file) => /<header[\s>]/.test(read(file)));
  assert.deepEqual(withHeader, ["components/app-shell/app-header.tsx"]);
  assert.equal(read("components/app-shell/app-header.tsx").match(/<header[\s>]/g)?.length, 1);
});

test("Studio and brand pages use the shared profile menu, never Clerk's UserButton", () => {
  for (const file of [...sources("app/(main)/studio"), ...sources("app/(main)/brand"), ...sources("components/app-shell")]) {
    assert.doesNotMatch(read(file), /UserButton/, file);
  }
  assert.match(read("components/app-shell/app-header.tsx"), /<UserProfile \/>/);
});
