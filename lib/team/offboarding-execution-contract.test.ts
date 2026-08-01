import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const source = fs.readFileSync(path.join(process.cwd(), "app/(main)/admin/team/actions.ts"), "utf8");
const execution = source.slice(
  source.indexOf("export async function executeTransferResponsibilities"),
  source.indexOf("// ============ TEAM MEMBER MANAGEMENT"),
);
const responsibilities = fs.readFileSync(path.join(process.cwd(), "lib/team/offboarding-responsibilities.ts"), "utf8");
const actions = fs.readFileSync(path.join(process.cwd(), "app/(main)/admin/team/actions.ts"), "utf8");
const teamComponents = ["team-member-card.tsx", "team-member-card 2.tsx", "team-members-list.tsx"]
  .map((name) => fs.readFileSync(path.join(process.cwd(), "app/(main)/admin/team/_components", name), "utf8"))
  .join("\n");

test("execution re-previews and accepts no client location, role, IDs, or counts", () => {
  assert.match(execution, /verifyOffboardingConfirmationToken/);
  assert.match(execution, /previewTransferResponsibilities/);
  assert.match(execution, /confirmationPhrase !== requiredOffboardingPhrase\(token\.mode/);
  assert.match(execution, /preview\.fingerprint !== token\.previewFingerprint/);
  assert.doesNotMatch(execution, /input\.(locationId|sourceUserId|successorUserId|counts|role|isAdmin)/);
});

test("one transaction transfers only active responsibilities and retains the User", () => {
  assert.match(execution, /db\.\$transaction/);
  assert.match(execution, /token\.mode === 'TRANSFER'/);
  assert.match(execution, /applyOffboardingResponsibilityMode\(tx/);
  assert.match(responsibilities, /contact\.updateMany[\s\S]*leadAssignedToAgent: input\.successorUserId/);
  assert.match(responsibilities, /dealContext\.updateMany[\s\S]*stage: \{ not: 'CLOSED' \}/);
  assert.match(responsibilities, /contactTask\.updateMany/);
  assert.match(responsibilities, /viewingSession\.updateMany[\s\S]*status: \{ notIn: \['completed', 'expired'\] \}/);
  assert.match(execution, /viewing\.findMany[\s\S]*date: \{ gte: new Date\(token\.responsibilityCutoff\) \}[\s\S]*status: \{ notIn:/);
  assert.match(responsibilities, /viewing\.updateMany[\s\S]*input\.viewingIds/);
  assert.match(execution, /user\.update\([\s\S]*locations: \{ disconnect:/);
  assert.doesNotMatch(execution, /user\.delete|contact\.create|conversation\.create|message\.(update|create)|contactHistory\.(update|delete)/);
});

test("the legacy removal API fails closed and confirmed execution is the only membership-removal path", () => {
  const legacy = actions.slice(actions.indexOf("export async function removeUserFromLocation"), actions.indexOf("// ============ GHL CALENDAR"));
  assert.match(legacy, /Direct removal is disabled/);
  assert.doesNotMatch(legacy, /db\.|removeGHL|revalidatePath/);
  assert.doesNotMatch(teamComponents, /removeUserFromLocation|Remove team member/);
  const removalMatches = actions.match(/userLocationRole\.delete\(/g) || [];
  const disconnectMatches = actions.match(/locations:\s*\{\s*disconnect:/g) || [];
  assert.equal(removalMatches.length, 1);
  assert.equal(disconnectMatches.length, 1);
  assert.match(execution, /userLocationRole\.delete/);
});

test("KEEP_ASSIGNED performs no responsibility assignment mutation but removes membership and retains identity", () => {
  assert.match(responsibilities, /input\.mode === 'KEEP_ASSIGNED'/);
  assert.match(responsibilities, /contacts: 0, deals: 0, tasks: 0, viewingSessions: 0, futureViewings: 0/);
  assert.match(execution, /user\.update\([\s\S]*locations: \{ disconnect:/);
  assert.match(execution, /userLocationRole\.delete/);
  assert.doesNotMatch(execution, /email: null|user\.delete/);
});

test("last-admin, other-membership, private-state, audit, and provider ordering are guarded", () => {
  assert.match(execution, /activeAdminCount <= 1/);
  assert.match(execution, /TransactionIsolationLevel\.Serializable/);
  assert.match(execution, /error\.code === 'P2034'[\s\S]*fresh preview/);
  assert.match(execution, /hasOtherMembership = otherRoleCount > 0 \|\| otherConnectionCount > 0/);
  assert.match(execution, /shouldClearUserGlobalPrivateState\(otherRoleCount, otherConnectionCount\)/);
  assert.match(execution, /clearPrivateState \? \[/);
  assert.match(execution, /googleAccessToken: null[\s\S]*outlookAccessToken: null[\s\S]*crmUsername: null/);
  assert.match(execution, /taskReminderJob\.updateMany[\s\S]*locationId: token\.locationId[\s\S]*userId: token\.sourceUserId[\s\S]*\['pending', 'processing', 'failed'\]/);
  assert.match(execution, /userOffboardingAudit\.create/);
  const transactionEnd = execution.indexOf("const externalErrors");
  assert.ok(transactionEnd > execution.indexOf("db.$transaction"));
  const external = execution.slice(transactionEnd);
  assert.match(external, /enqueueTaskSyncJobs/);
  assert.match(external, /enqueueViewingSyncJobs/);
  assert.match(external, /removeGHLUserFromLocation/);
  assert.match(external, /revokeSession/);
  assert.match(external, /banUser/);
});

test("the serializable transaction revalidates and asserts the confirmed responsibility counts", () => {
  const transaction = execution.slice(execution.indexOf("db.$transaction"), execution.indexOf("const externalErrors"));
  assert.match(transaction, /countOffboardingResponsibilities\(tx/);
  assert.match(transaction, /new Date\(token\.responsibilityCutoff\)/);
  assert.match(transaction, /transactionalFingerprint !== token\.previewFingerprint/);
  assert.match(transaction, /responsibilityChanges\.contacts !== transactionalCounts\.assignedContacts/);
  assert.match(transaction, /Responsibility transfer count changed; transaction rolled back/);
});

test("post-commit failures remain local success and replay stays denied", () => {
  assert.match(execution, /let localCommit:/);
  assert.match(execution, /if \(localCommit\)[\s\S]*success: true/);
  assert.match(execution, /Audit finalization requires attention; the LOCAL_COMPLETE audit remains authoritative/);
  assert.match(execution, /error\.code === 'P2002'[\s\S]*already used/);
  assert.doesNotMatch(execution, /externalErrors\.push\(`[^`]*\$\{/);
});
