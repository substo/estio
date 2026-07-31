import assert from 'node:assert/strict';
import test from 'node:test';
import { getActiveProspectingAccess, requireAllRequestedIds } from './prospecting-access';

test('same-location users resolve shared prospecting access with actor attribution', async () => {
  const access = await getActiveProspectingAccess(null, {
    getClerkUserId: async () => 'clerk-user-b',
    getActiveLocationId: async () => 'location-a',
    getInternalUserId: async (clerkUserId) => clerkUserId === 'clerk-user-b' ? 'user-b' : null,
  });

  assert.deepEqual(access, { userId: 'user-b', locationId: 'location-a' });
});

test('a client location assertion cannot select another location', async () => {
  let internalLookupCount = 0;
  const access = await getActiveProspectingAccess('location-b', {
    getClerkUserId: async () => 'clerk-user-a',
    getActiveLocationId: async () => 'location-a',
    getInternalUserId: async () => {
      internalLookupCount += 1;
      return 'user-a';
    },
  });

  assert.equal(access, null);
  assert.equal(internalLookupCount, 0);
});

test('single and bulk ID authorization fails closed on any foreign target', () => {
  assert.deepEqual(requireAllRequestedIds(['prospect-a'], ['prospect-a']), ['prospect-a']);
  assert.deepEqual(requireAllRequestedIds(['listing-a', 'listing-a'], ['listing-a']), ['listing-a']);
  assert.equal(requireAllRequestedIds(['listing-a', 'listing-b'], ['listing-a']), null);
});

test('related contact, property, and company IDs must all be authorized in the location', () => {
  const requestedRelationships = ['contact-a', 'property-a', 'company-a'];
  assert.deepEqual(requireAllRequestedIds(requestedRelationships, requestedRelationships), requestedRelationships);
  assert.equal(requireAllRequestedIds(requestedRelationships, ['contact-a', 'property-a']), null);
});
