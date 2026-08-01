import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');
const component = readFileSync(new URL('./_components/assignment-recovery.tsx', import.meta.url), 'utf8');
const card = readFileSync(new URL('./_components/team-member-card.tsx', import.meta.url), 'utf8');
const preview = actions.slice(actions.indexOf('export async function previewAssignmentRecovery'), actions.indexOf('export type AssignmentRecoveryExecuteResult'));
const execution = actions.slice(actions.indexOf('export async function executeAssignmentRecovery'), actions.indexOf('/** Read-only preview.'));

test('recovery preview resolves exact selected-user identity and all counts server-side', () => {
  assert.match(card, /<AssignmentRecovery sourceEmail=\{user\.email\}/);
  assert.match(preview, /normalizeOffboardingEmail/);
  assert.match(preview, /requireExactPreviewIdentity/);
  assert.match(preview, /resolveStrictAdminLocation/);
  assert.match(preview, /countAssignmentRecovery\(db/);
  assert.doesNotMatch(preview, /input\.(locationId|targetUserId|counts|role)/);
});

test('recovery execution is signed, replay-safe, serializable, and transactionally revalidates counts', () => {
  assert.match(execution, /verifyAssignmentRecoveryToken/);
  assert.match(execution, /previewAssignmentRecovery/);
  assert.match(execution, /countAssignmentRecovery\(tx/);
  assert.match(execution, /TransactionIsolationLevel\.Serializable/);
  assert.match(execution, /createAssignmentRecoveryFingerprint/);
  assert.match(execution, /Assignment recovery count changed; transaction rolled back/);
  assert.match(execution, /userOffboardingAudit\.create/);
  assert.match(execution, /confirmationId: token\.confirmationId/);
  assert.match(execution, /P2002/);
});

test('recovery preserves historical and shared records and presents explicit confirmation', () => {
  assert.match(component, /Shared records and historical actors remain unchanged/);
  assert.match(component, /messages, ContactHistory, completed\/past Viewings/);
  assert.match(component, /acknowledgeHistoricalPreservation/);
  assert.match(component, /Assign all current responsibilities/);
  assert.doesNotMatch(execution, /message\.(update|updateMany|delete)|contactHistory\.(update|updateMany|delete)/);
});
