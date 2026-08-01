import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const formSource = readFileSync('app/(main)/admin/contacts/_components/contact-form.tsx', 'utf8');
const actionSource = readFileSync('app/(main)/admin/contacts/actions.ts', 'utf8');
const pageSource = readFileSync('app/(main)/admin/contacts/page.tsx', 'utf8');
const filtersSource = readFileSync('app/(main)/admin/contacts/_components/contact-filters.tsx', 'utf8');
const rowSource = readFileSync('app/(main)/admin/contacts/_components/contact-row.tsx', 'utf8');
const schemaSource = readFileSync('prisma/schema.prisma', 'utf8');
const migrationSource = readFileSync('prisma/migrations/20260801120000_contact_assigned_user/migration.sql', 'utf8');
const teamActionSource = readFileSync('app/(main)/admin/team/actions.ts', 'utf8');
const teamPageSource = readFileSync('app/(main)/admin/team/page.tsx', 'utf8');
const companyPageSource = readFileSync('app/(main)/admin/companies/page.tsx', 'utf8');
const companyDetailSource = readFileSync('app/(main)/admin/companies/[id]/view/page.tsx', 'utf8');

test('actual add and edit form identity and relationship payloads match server inputs', () => {
  for (const field of ['locationId', 'contactId', 'contactType', 'name', 'email', 'phone', 'entityId', 'entityIds', 'roleType', 'roleName']) {
    assert.match(formSource, new RegExp(`name=["'{][^\\n]*${field}`), `Contacts form must submit ${field}`);
    assert.match(actionSource, new RegExp(`formData\\.get\\('${field}'\\)`), `Contacts action must read ${field}`);
  }

  assert.match(formSource, /name="entityIds" value=\{JSON\.stringify\(selectedPropertyIds\)\}/);
  assert.match(formSource, /name="entityId"[\s\S]{0,180}selectedPropertyId[\s\S]{0,80}selectedCompanyId/);
});

test('list scope and changed accessibility controls remain explicit', () => {
  assert.match(pageSource, /const access = await getActiveContactsAccess\(\)/);
  assert.match(pageSource, /const where: any = buildContactVisibilityWhere\(access, scope\)/);
  assert.match(pageSource, /resolveContactScope\(access, scope\)/);
  assert.match(filtersSource, /My assignments/);
  assert.match(filtersSource, /All location/);
  assert.match(filtersSource, /isAdmin \?/);
  assert.match(pageSource, /where\.AND = \[[\s\S]{0,180}propertiesInterested[\s\S]{0,180}propertiesEmailed/);
  assert.doesNotMatch(pageSource, /searchParams\.locationId \|\|/);
  assert.match(rowSource, /href=\{`\/admin\/contacts\/\$\{contact\.id\}\/view`\}/);
  assert.doesNotMatch(rowSource, /<tr onClick=/);
  assert.match(formSource, /<Label htmlFor=\{fieldId\}>/);
  assert.match(formSource, /SelectTrigger aria-label="Assigned agent"/);
  assert.match(rowSource, /aria-label=\{hasError/);
  assert.match(pageSource, /canViewLocationContacts\(access\)/);
  assert.match(pageSource, /canManage=\{canManageContact\(access, contact\.assignedUserId\)\}/);
  assert.match(rowSource, /canManage \? <EditContactDialog/);
  assert.match(rowSource, /Read-only/);
});

test('pipeline and Google sync mutations use the active Contacts location', () => {
  for (const functionName of ['importNewGoogleContactAction', 'resolveSyncConflict', 'unlinkGoogleContact', 'verifyAndHealContact', 'updateContactStage']) {
    const start = actionSource.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} must exist`);
    assert.match(actionSource.slice(start, start + 900), /getActiveContactsAccess\(/, `${functionName} must resolve active location`);
  }
  assert.match(actionSource, /updateContactStage[\s\S]{0,180}LEAD_STAGES\.includes/);
});

test('canonical Contact assignment is a nullable User relation with exact-only backfill', () => {
  assert.match(schemaSource, /assignedUserId\s+String\?/);
  assert.match(schemaSource, /@relation\("ContactAssignedUser"[\s\S]{0,120}onDelete: SetNull/);
  assert.match(migrationSource, /app_user\.id = contact\."leadAssignedToAgent"/);
  assert.match(migrationSource, /"_LocationToUser"/);
  assert.match(migrationSource, /"UserLocationRole"/);
  assert.doesNotMatch(migrationSource, /ILIKE|LIKE|lower\(|trim\(/i);
  assert.doesNotMatch(migrationSource, /INSERT INTO "Contact"|UPDATE "ContactHistory"/);
  assert.match(schemaSource, /enum ContactAccessScope[\s\S]*ASSIGNED_ONLY[\s\S]*LOCATION_WIDE/);
  assert.match(schemaSource, /contactAccessScope\s+ContactAccessScope\s+@default\(ASSIGNED_ONLY\)/);
  assert.match(migrationSource, /DEFAULT 'ASSIGNED_ONLY'/);
  assert.match(migrationSource, /SET "contactAccessScope" = 'LOCATION_WIDE'[\s\S]*WHERE "role" = 'MEMBER'/);
});

test('core Contact reads and mutations enforce assignment visibility and dual-write the compatibility field', () => {
  for (const functionName of [
    'openOrStartConversationForContact', 'updateContactAction', 'updateContactIdentityAction',
    'updateContactTypeAction', 'deleteContact', 'getContactDetails', 'searchContactsAction',
    'previewMergeContacts', 'mergeContacts', 'updateContactStage',
  ]) {
    const start = actionSource.indexOf(`export async function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} must exist`);
    assert.match(actionSource.slice(start, start + 6000), /buildContact(Manage|Visibility)Where\(access/, `${functionName} must apply Contact ownership`);
  }
  assert.match(actionSource, /assignedUserId: data\.leadAssignedToAgent/);
  assert.match(actionSource, /assignedUserId: access\.internalUserId/);
});

test('Team ADMIN can grant the approved MEMBER Contact visibility scope', () => {
  assert.match(teamActionSource, /updateMemberContactAccess/);
  assert.match(teamActionSource, /contactAccessScope/);
  assert.match(teamActionSource, /LOCATION_WIDE/);
  assert.match(teamPageSource, /contactAccessScope: true/);
  assert.doesNotMatch(teamPageSource, /isAdmin = true[^;]*Default|fallback to allowing all location users/);
  assert.match(teamPageSource, /resolveStrictAdminLocation/);
});

test('Companies project only contacts visible through the shared Contact predicate', () => {
  assert.match(companyPageSource, /contactVisibilityWhere: buildContactVisibilityWhere\(access, 'location'\)/);
  assert.match(companyDetailSource, /const contactVisibilityWhere = buildContactVisibilityWhere\(access, 'location'\)/);
  assert.match(companyDetailSource, /where: \{ contact: contactVisibilityWhere \}/);
});
