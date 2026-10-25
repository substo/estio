import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function actions(allowed = true) {
  const selections: string[] = [], writes: string[] = [];
  const deps: Record<string, any> = {
    "next/cache": { revalidatePath: () => {} }, "next/navigation": { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } },
    "@/lib/brands/brand-policy": {},
    "@/lib/brands/substo-brands": { getSubstoBrandActor: async (id: string) => { selections.push(id); return allowed ? { userId: "actor", locationId: id, role: "ADMIN" } : null; }, substoBrandDeps: () => ({}), substoSignUpUrl: () => "https://substo.com/sign-up" },
    "@/lib/brands/brand-service": {},
  };
  for (const name of ["inviteToBrand", "changeMemberRole", "removeMember", "renameBrand", "revokeBrandInvitation"]) {
    deps["@/lib/brands/brand-service"][name] = async (_deps: unknown, actor: { locationId: string }) => { writes.push(actor.locationId); return { ok: true }; };
  }
  deps["@/lib/brands/brand-policy"] = {};
  // Parsing currently lives in the policy module imported directly by actions.
  deps["@/lib/brands/brand-policy"].parseBrandRole = (value: unknown) => value === "ADMIN" || value === "MEMBER" ? value : null;
  const code = ts.transpileModule(fs.readFileSync("app/(main)/brand/actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} as any };
  vm.runInNewContext(code, { module, exports: module.exports, require: (name: string) => { assert.ok(name in deps, name); return deps[name]; } });
  return { api: module.exports, selections, writes };
}
function form() { const value = new FormData(); value.set("locationId", "rendered-a"); value.set("role", "MEMBER"); value.set("userId", "member"); value.set("email", "synthetic@example.invalid"); value.set("name", "Display name"); value.set("invitationId", "invite"); return value; }
test("all brand operations use the rendered tenant, independent of another tab's cookie", async () => {
  const { api, selections, writes } = actions();
  for (const name of ["inviteBrandMemberAction", "changeBrandMemberRoleAction", "removeBrandMemberAction", "renameBrandAction"]) await api[name]({}, form());
  await api.revokeBrandInvitationAction(form());
  assert.deepEqual(selections, Array(5).fill("rendered-a")); assert.deepEqual(writes, Array(5).fill("rendered-a"));
});
test("revoked/foreign tenant and missing rendered identity cannot invoke services", async () => {
  const denied = actions(false);
  await assert.rejects(denied.api.inviteBrandMemberAction({}, form()), /REDIRECT/); assert.equal(denied.writes.length, 0);
  const missing = actions(); const input = form(); input.delete("locationId");
  await assert.rejects(missing.api.renameBrandAction({}, input), /REDIRECT/); assert.equal(missing.selections.length, 0); assert.equal(missing.writes.length, 0);
});
