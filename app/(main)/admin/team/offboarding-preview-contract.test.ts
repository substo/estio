import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('./_components/offboarding-preview.tsx', import.meta.url), 'utf8');
const teamPage = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
const memberCard = readFileSync(new URL('./_components/team-member-card.tsx', import.meta.url), 'utf8');
const responsibilities = readFileSync(new URL('../../../../lib/team/offboarding-responsibilities.ts', import.meta.url), 'utf8');
const preview = actions.slice(
  actions.indexOf('export async function previewTransferResponsibilities'),
  actions.indexOf('export type ExecuteOffboardingResult'),
);

test('preview accepts exact identity intent and derives actor, location, and counts server-side', () => {
  assert.match(preview, /sourceUserId: string;\s*successorUserId\?: string;\s*mode: OffboardingMode;\s*suspendClerkGlobally: boolean/);
  assert.doesNotMatch(preview, /input\.(locationId|counts|role|isAdmin)/);
  assert.match(preview, /await auth\(\)/);
  assert.match(preview, /resolveStrictAdminLocation/);
  assert.match(preview, /where: \{ id: \{ in: requestedIds \} \}/);
  assert.match(preview, /requirePreviewIdentityById/);
  assert.match(preview, /clerk\.users\.getUser\(sourceLocal\.clerkId\)/);
  assert.match(preview, /countOffboardingResponsibilities\(db/);
  assert.match(responsibilities, /conversation\.count/);
  assert.match(responsibilities, /contactTask\.count/);
  assert.match(responsibilities, /viewingSession\.count/);
});

test('Team actions have no cookie-selected location or connected-member admin fallback', () => {
  assert.doesNotMatch(actions, /cookies\(\)|crm_location_id|getLocationContext/);
  assert.doesNotMatch(actions, /any user connected to the location is allowed|fallback to legacy check/i);
  assert.match(actions, /locationRoles:[\s\S]*role: 'ADMIN'/);
  assert.match(actions, /user\.locations\.length !== 1 \|\| user\.locationRoles\.length !== 1/);
});

test('preview performs no database, Clerk, GHL, Google, or Microsoft mutation', () => {
  assert.doesNotMatch(preview, /db\.[a-zA-Z]+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
  assert.doesNotMatch(preview, /users\.(updateUser|banUser|deleteUser)|revokeSession|removeGHLUserFromLocation|googleapis|graphClient/i);
  assert.match(preview, /clerk\.users\.getUser/);
});

test('classification keeps shared records unchanged and historical actors preserved', () => {
  for (const label of ['Properties', 'Companies', 'Projects', 'Prospecting records']) {
    assert.match(preview, new RegExp(`label: '${label}'`));
  }
  assert.match(preview, /Contact history actor entries/);
  assert.match(preview, /Message sender entries/);
  assert.match(preview, /Property creator\/updater records/);
  assert.match(responsibilities, /assignedUserId: sourceUserId[\s\S]*stage: \{ not: 'CLOSED' \}/);
  assert.match(preview, /Active deals without a safe assignee/);
});

test('last-admin, other-membership, and legacy-unassigned classifications are server-derived', () => {
  assert.match(preview, /adminCount <= 1/);
  assert.match(preview, /final active ADMIN/);
  assert.match(preview, /otherMemberships\.length/);
  assert.match(preview, /Global identity retirement is unavailable while the source has other location memberships/);
  assert.match(responsibilities, /assignedUserId: sourceUserId/);
  assert.match(preview, /Legacy contacts left unassigned/);
  assert.match(component, /View details/);
});

test('private credentials are classified but never rendered or returned', () => {
  assert.match(preview, /googleAccessToken/);
  assert.match(preview, /outlookSessionCookies/);
  assert.doesNotMatch(component, /googleAccessToken|googleRefreshToken|outlookAccessToken|outlookRefreshToken|crmPassword/);
  assert.match(component, /Private state is never transferred/);
});

test('confirmation UI is accessible and execution requires explicit phrase and acknowledgement', () => {
  assert.match(component, /<Dialog /);
  assert.match(component, /onOpenAutoFocus/);
  assert.match(component, /htmlFor=\{`\$\{fieldId\}-successor`\}/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /role="alert"/);
  assert.match(component, /aria-busy=\{loading \|\| executing\}/);
  assert.match(component, /Explicit final confirmation/);
  assert.match(component, /confirmationPhrase/);
  assert.match(component, /acknowledgeNoHistoricalRewrite/);
  assert.match(component, /Transfer active work/);
  assert.match(component, /Leave assigned to inactive user/);
  assert.match(component, /Remove from location/);
  assert.match(component, /Retire global login/);
  assert.match(component, /disabled=\{hasOtherMembership \|\| loading \|\| executing\}/);
  assert.match(component, /Execution blocked until every condition is resolved/);
});

test('offboarding is bound to the selected Team member instead of a standalone email form', () => {
  assert.match(memberCard, /Manage user/);
  assert.match(memberCard, /!isCurrentUser &&/);
  assert.match(memberCard, /<RemoveUserDialog/);
  assert.match(memberCard, /source=\{\{ id: user\.id, email: user\.email/);
  assert.match(teamPage, /removalMembers=\{removalMembers\}/);
  assert.match(component, /sourceUserId: source\.id/);
  assert.match(component, /successorUserId: mode === 'TRANSFER' \? successorUserId/);
  assert.match(component, /<option key=\{member\.id\} value=\{member\.id\}>/);
  assert.doesNotMatch(component, /type="email"|name="sourceEmail"|successorEmail/);
  assert.doesNotMatch(memberCard, /invitedById === null/);
});

test('self-removal and member direct invocation fail closed server-side', () => {
  assert.match(preview, /resolveStrictAdminLocation\(actorRecord/);
  assert.match(preview, /source\.id === actorRecord!\.id/);
  assert.match(preview, /You cannot remove yourself from the active location/);
  assert.match(actions, /actor\.id === token\.sourceUserId/);
});

test('success refreshes the Team list and announces audit and generic cleanup status', () => {
  assert.match(component, /router\.replace\(`\/admin\/team\?\$\{query\.toString\(\)\}`\)/);
  assert.match(component, /router\.refresh\(\)/);
  assert.match(teamPage, /role="status" aria-live="polite"/);
  assert.match(teamPage, /Audit ID:/);
  assert.match(teamPage, /successful local removal was not rolled back/);
});
