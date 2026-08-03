import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const actions = readFileSync(new URL('./actions.ts', import.meta.url), 'utf8');
const card = readFileSync(new URL('./_components/team-member-card.tsx', import.meta.url), 'utf8');
const preview = actions.slice(actions.indexOf('export async function previewAssignmentRecovery'), actions.indexOf('export type AssignmentRecoveryExecuteResult'));
const execution = actions.slice(actions.indexOf('export async function executeAssignmentRecovery'), actions.indexOf('/** Read-only preview.'));

test('legacy bulk recovery is not exposed in normal Team member management', () => {
  assert.equal(existsSync(new URL('./_components/assignment-recovery.tsx', import.meta.url)), false);
  assert.doesNotMatch(card, /AssignmentRecovery|Recover legacy assignments|assignment recovery/i);
  assert.match(card, /Remove from this location/);
  assert.match(card, /<RemoveUserDialog/);
});

test('retained emergency recovery preview resolves exact identity and all counts server-side', () => {
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

test('retained emergency recovery preserves historical and shared records', () => {
  assert.doesNotMatch(execution, /message\.(update|updateMany|delete)|contactHistory\.(update|updateMany|delete)/);
});
