import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('./_components/offboarding-preview.tsx', import.meta.url), 'utf8');
const responsibilities = readFileSync(new URL('../../../../lib/team/offboarding-responsibilities.ts', import.meta.url), 'utf8');
const preview = actions.slice(
  actions.indexOf('export async function previewTransferResponsibilities'),
  actions.indexOf('export type ExecuteOffboardingResult'),
);

test('preview accepts exact identity intent and derives actor, location, and counts server-side', () => {
  assert.match(preview, /sourceEmail: string;\s*successorEmail\?: string;\s*mode: OffboardingMode;\s*suspendClerkGlobally: boolean/);
  assert.doesNotMatch(preview, /input\.(locationId|counts|role|isAdmin)/);
  assert.match(preview, /await auth\(\)/);
  assert.match(preview, /resolveStrictAdminLocation/);
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
  assert.match(preview, /clerk\.users\.getUserList/);
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
  assert.match(component, /Blocked or explicitly unchanged/);
});

test('private credentials are classified but never rendered or returned', () => {
  assert.match(preview, /googleAccessToken/);
  assert.match(preview, /outlookSessionCookies/);
  assert.doesNotMatch(component, /googleAccessToken|googleRefreshToken|outlookAccessToken|outlookRefreshToken|crmPassword/);
  assert.match(component, /Private state — never transferred/);
});

test('confirmation UI is accessible and execution requires explicit phrase and acknowledgement', () => {
  assert.match(component, /htmlFor="sourceEmail"/);
  assert.match(component, /htmlFor="successorEmail"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /Explicit final confirmation/);
  assert.match(component, /confirmationPhrase/);
  assert.match(component, /acknowledgeNoHistoricalRewrite/);
  assert.match(component, /Will transfer on confirmation/);
  assert.match(component, /Will remain assigned to the inactive user/);
  assert.match(component, /Remove access to this location/);
  assert.match(component, /Globally retire identity/);
  assert.match(component, /Execution blocked until every condition above is resolved/);
});
