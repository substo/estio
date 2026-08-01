import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildContactManageWhere,
  buildContactVisibilityWhere,
  canManageContact,
  canAssignContactTo,
  canUpdateMemberContactAccess,
  getActiveContactsAccess,
  resolveContactScope,
  validateContactRelationships,
  type ContactRelationshipRepository,
} from './active-location-access';

const repository = (locationRecords: Record<string, { properties: string[]; companies: string[]; users: string[] }>): ContactRelationshipRepository => ({
  async findPropertyIds(locationId, ids) {
    return ids.filter((id) => locationRecords[locationId]?.properties.includes(id));
  },
  async findCompanyIds(locationId, ids) {
    return ids.filter((id) => locationRecords[locationId]?.companies.includes(id));
  },
  async findUserIds(locationId, ids) {
    return ids.filter((id) => locationRecords[locationId]?.users.includes(id));
  },
});

async function accessFor(role: 'ADMIN' | 'MEMBER' | null, contactAccessScope: 'ASSIGNED_ONLY' | 'LOCATION_WIDE' | null = 'ASSIGNED_ONLY', connected = true) {
  return getActiveContactsAccess('location_a', {
    getAuthUserId: async () => 'clerk_a',
    getActiveLocationId: async () => 'location_a',
    findActor: async () => ({ id: 'user_a', connected, role, contactAccessScope }),
  });
}

test('ADMIN sees and manages all active-location contacts', async () => {
  const admin = await accessFor('ADMIN');
  assert.ok(admin);
  assert.equal(resolveContactScope(admin, 'location'), 'location');
  assert.equal(resolveContactScope(admin, 'my'), 'my');
  assert.deepEqual(buildContactVisibilityWhere(admin, 'location'), { locationId: 'location_a' });
  assert.deepEqual(buildContactManageWhere(admin), { locationId: 'location_a' });
  assert.equal(canManageContact(admin, null), true);
  assert.equal(canManageContact(admin, 'user_b'), true);
});

test('ASSIGNED_ONLY member sees and manages only their assignments', async () => {
  const member = await accessFor('MEMBER', 'ASSIGNED_ONLY');
  assert.ok(member);
  assert.equal(resolveContactScope(member, 'location'), 'my');
  assert.deepEqual(buildContactVisibilityWhere(member, 'location'), {
    locationId: 'location_a', assignedUserId: 'user_a',
  });
  assert.deepEqual(buildContactManageWhere(member), { locationId: 'location_a', assignedUserId: 'user_a' });
  assert.equal(canManageContact(member, 'user_a'), true);
  assert.equal(canManageContact(member, 'user_b'), false);
  assert.equal(canManageContact(member, null), false);
});

test('LOCATION_WIDE member sees all contacts but manages only their assignments', async () => {
  const member = await accessFor('MEMBER', 'LOCATION_WIDE');
  assert.ok(member);
  assert.equal(resolveContactScope(member, 'location'), 'location');
  assert.deepEqual(buildContactVisibilityWhere(member, 'location'), { locationId: 'location_a' });
  assert.deepEqual(buildContactManageWhere(member), { locationId: 'location_a', assignedUserId: 'user_a' });
  assert.equal(canManageContact(member, 'user_a'), true);
  assert.equal(canManageContact(member, 'user_b'), false);
  assert.equal(canManageContact(member, null), false);
});

test('client location assertions cannot select another active location', async () => {
  const access = await getActiveContactsAccess('location_b', {
    getAuthUserId: async () => 'user_a',
    getActiveLocationId: async () => 'location_a',
    findActor: async () => ({ id: 'user_a', connected: true, role: 'ADMIN', contactAccessScope: 'ASSIGNED_ONLY' }),
  });
  assert.equal(access, null);
});

test('missing role or disconnected membership denies access with no fallback', async () => {
  assert.equal(await accessFor(null), null);
  assert.equal(await accessFor('ADMIN', 'ASSIGNED_ONLY', false), null);
});

test('only ADMIN may update a MEMBER contact-access setting', () => {
  assert.equal(canUpdateMemberContactAccess('ADMIN', 'MEMBER'), true);
  assert.equal(canUpdateMemberContactAccess('MEMBER', 'MEMBER'), false);
  assert.equal(canUpdateMemberContactAccess('ADMIN', 'ADMIN'), false);
});

test('canonical edits remain one shared record and retain attribution', async () => {
  const contact = { id: 'contact_a', locationId: 'location_a', assignedUserId: 'user_a', name: 'Before' };
  const history = [{ contactId: contact.id, userId: 'creator', action: 'created' }];
  const views = [await accessFor('ADMIN'), await accessFor('MEMBER', 'LOCATION_WIDE')];
  contact.name = 'After';
  history.push({ contactId: contact.id, userId: 'user_a', action: 'updated' });
  assert.equal(new Set(views.map(() => contact.id)).size, 1);
  assert.equal(views.every((access) => access && buildContactVisibilityWhere(access, 'location').locationId === contact.locationId), true);
  assert.equal(contact.name, 'After');
  assert.deepEqual(history.map((entry) => entry.userId), ['creator', 'user_a']);
});

test('members may assign only themselves while ADMIN can assign or leave unassigned', async () => {
  const admin = await accessFor('ADMIN');
  const member = await accessFor('MEMBER');
  assert.ok(admin && member);
  assert.equal(canAssignContactTo(member, 'user_a'), true);
  assert.equal(canAssignContactTo(member, 'user_b'), false);
  assert.equal(canAssignContactTo(member, null), false);
  assert.equal(canAssignContactTo(admin, 'user_b'), true);
  assert.equal(canAssignContactTo(admin, null), true);
});

test('same-location create and edit relationships are accepted', async () => {
  const errors = await validateContactRelationships(repository({
    location_a: { properties: ['property_a'], companies: ['company_a'], users: ['user_b'] },
  }), 'location_a', {
    roleType: 'company',
    entityId: 'company_a',
    propertiesInterested: ['property_a'],
    leadAssignedToAgent: 'user_b',
  });
  assert.equal(errors, null);
});

test('cross-location relationship IDs are rejected before mutation', async () => {
  const errors = await validateContactRelationships(repository({
    location_a: { properties: [], companies: [], users: [] },
    location_b: { properties: ['property_b'], companies: ['company_b'], users: ['user_b'] },
  }), 'location_a', {
    roleType: 'company',
    entityId: 'company_b',
    propertiesInterested: ['property_b'],
    leadAssignedToAgent: 'user_b',
  });
  assert.deepEqual(errors, {
    entityIds: ['One or more selected properties are unavailable for this location.'],
    entityId: ['The selected company is unavailable for this location.'],
    leadAssignedToAgent: ['The selected agent is unavailable for this location.'],
  });
});
