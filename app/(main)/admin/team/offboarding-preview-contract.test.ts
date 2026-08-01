import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('./_components/offboarding-preview.tsx', import.meta.url), 'utf8');
const preview = actions.slice(
  actions.indexOf('export async function previewTransferResponsibilities'),
  actions.indexOf('// ============ TEAM MEMBER MANAGEMENT'),
);

test('preview accepts only identity emails and derives actor, location, and counts server-side', () => {
  assert.match(preview, /sourceEmail: string;\s*successorEmail: string/);
  assert.doesNotMatch(preview, /input\.(locationId|counts|role|isAdmin)/);
  assert.match(preview, /await auth\(\)/);
  assert.match(preview, /resolveStrictAdminLocation/);
  assert.match(preview, /db\.contact\.count/);
  assert.match(preview, /db\.conversation\.count/);
  assert.match(preview, /db\.contactTask\.count/);
  assert.match(preview, /db\.viewingSession\.count/);
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
  assert.match(preview, /DealContext has no authoritative user assignment field/);
});

test('last-admin, other-membership, and legacy-unassigned classifications are server-derived', () => {
  assert.match(preview, /adminCount <= 1/);
  assert.match(preview, /final active ADMIN/);
  assert.match(preview, /otherMemberships\.length/);
  assert.match(preview, /global retirement requires a separate explicit decision/);
  assert.match(preview, /assignedUserId: source\.id/);
  assert.match(preview, /Legacy contacts left unassigned/);
  assert.match(component, /Blocked or explicitly unchanged/);
});

test('private credentials are classified but never rendered or returned', () => {
  assert.match(preview, /googleAccessToken/);
  assert.match(preview, /outlookSessionCookies/);
  assert.doesNotMatch(component, /googleAccessToken|googleRefreshToken|outlookAccessToken|outlookRefreshToken|crmPassword/);
  assert.match(component, /Private state — never transferred/);
});

test('confirmation UI is accessible and execution is explicitly disabled', () => {
  assert.match(component, /htmlFor="sourceEmail"/);
  assert.match(component, /htmlFor="successorEmail"/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /Execution unavailable until ownership Slices 3–5 are complete/);
  assert.match(component, /disabled className="w-full"/);
});
