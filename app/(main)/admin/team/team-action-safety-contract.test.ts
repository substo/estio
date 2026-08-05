import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const actions = fs.readFileSync(path.join(process.cwd(), 'app/(main)/admin/team/actions.ts'), 'utf8');
const page = fs.readFileSync(path.join(process.cwd(), 'app/(main)/admin/team/page.tsx'), 'utf8');

function action(name: string, next: string) {
  return actions.slice(actions.indexOf(`export async function ${name}`), actions.indexOf(`export async function ${next}`));
}

test('calendar, profile, and role actions authorize the server location and reject foreign targets', () => {
  for (const source of [
    action('getGHLCalendars', 'updateUserCalendar'), action('updateUserCalendar', 'createGHLCalendarForUser'),
    action('createGHLCalendarForUser', 'updateTeamMemberProfile'), action('updateTeamMemberProfile', '__end__'),
  ]) {
    assert.match(source, /getCurrentLocationId\(\)/);
    assert.match(source, /requireAdminRole\(/);
  }
  assert.match(action('updateUserCalendar', 'createGHLCalendarForUser'), /locations: \{ some: \{ id: locationId \} \}/);
  assert.match(action('createGHLCalendarForUser', 'updateTeamMemberProfile'), /locations: \{ some: \{ id: activeLocationId \} \}/);
  assert.match(action('updateTeamMemberProfile', '__end__'), /locations: \{ some: \{ id: locationId \} \}/);
  const role = action('updateUserRole', 'removeUserFromLocation');
  assert.match(role, /adminUserId === userId/);
  assert.match(role, /activeAdmins <= 1/);
  assert.match(role, /user: \{ locations: \{ some: \{ id: locationId \} \} \}/);
});

test('invitation revoke, resend, and replacement are location-bound', () => {
  assert.match(action('inviteUserToLocation', 'revokeInvitation'), /existingInvite[\s\S]*publicMetadata\?\.locationId === locationId/);
  assert.match(action('revokeInvitation', 'resendInvitation'), /entry\.publicMetadata\?\.locationId === locationId/);
  assert.match(action('resendInvitation', 'updateUserRole'), /invitation\.publicMetadata\?\.locationId !== locationId/);
});

test('restoring an existing Clerk identity updates the local reference and new invitations request email delivery', () => {
  assert.match(actions, /user = await db\.user\.update\([\s\S]*data: \{ clerkId: clerkUsers\.data\[0\]\.id \}/);
  assert.match(actions, /Existing Estio account restored\. No invitation email was needed/);
  assert.match(actions, /createInvitation\([\s\S]*notify: true/);
  assert.match(actions, /Clerk was asked to send the access email/);
});

test('contact access redirects render accessible feedback', () => {
  assert.match(page, /contactAccessResult/);
  assert.match(page, /role=\{contactAccessResult === 'updated' \? 'status' : 'alert'\}/);
  assert.match(page, /aria-live="polite"/);
  assert.match(page, /Contact access updated\./);
});
