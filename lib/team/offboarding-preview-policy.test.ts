import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertOffboardingPair,
  normalizeOffboardingEmail,
  requireExactPreviewIdentity,
  resolveStrictAdminLocation,
  type PreviewIdentity,
} from './offboarding-preview-policy';

function identity(overrides: Partial<PreviewIdentity> = {}): PreviewIdentity {
  return {
    id: 'user_source',
    email: 'source@example.com',
    clerkId: 'clerk_source',
    firstName: 'Original',
    lastName: 'User',
    memberships: [{ locationId: 'loc_active', locationName: 'Active', role: 'ADMIN', connected: true }],
    ...overrides,
  };
}

test('ADMIN resolves the one server-side active location without a fallback', () => {
  assert.equal(resolveStrictAdminLocation(identity()).locationId, 'loc_active');
  assert.throws(() => resolveStrictAdminLocation(null), /Unauthorized/);
  assert.throws(() => resolveStrictAdminLocation(identity({
    memberships: [{ locationId: 'loc_active', locationName: 'Active', role: null, connected: true }],
  })), /ADMIN role/);
  assert.throws(() => resolveStrictAdminLocation(identity({
    memberships: [{ locationId: 'loc_active', locationName: 'Active', role: 'MEMBER', connected: true }],
  })), /ADMIN role/);
});

test('multiple ADMIN memberships fail closed when active location is not authoritative', () => {
  assert.throws(() => resolveStrictAdminLocation(identity({ memberships: [
    { locationId: 'loc_a', locationName: 'A', role: 'ADMIN', connected: true },
    { locationId: 'loc_b', locationName: 'B', role: 'ADMIN', connected: true },
  ] })), /ambiguous/);
});

test('identity resolution uses exact normalized email and matching local and Clerk IDs', () => {
  const source = identity({ email: ' Source@Example.com ' });
  const resolved = requireExactPreviewIdentity({
    label: 'Source',
    email: 'SOURCE@example.com',
    localMatches: [source],
    clerkMatches: [{ id: 'clerk_source', emails: ['source@example.com'] }],
    activeLocationId: 'loc_active',
  });
  assert.equal(normalizeOffboardingEmail(resolved.email), 'source@example.com');
  assert.equal(resolved.clerkId, 'clerk_source');
});

test('duplicate, missing, mismatched, and foreign-location identities are rejected', () => {
  const base = {
    label: 'Source' as const,
    email: 'source@example.com',
    localMatches: [identity()],
    clerkMatches: [{ id: 'clerk_source', emails: ['source@example.com'] }],
    activeLocationId: 'loc_active',
  };
  assert.throws(() => requireExactPreviewIdentity({ ...base, localMatches: [] }), /exactly one local/);
  assert.throws(() => requireExactPreviewIdentity({ ...base, clerkMatches: [] }), /exactly one Clerk/);
  assert.throws(() => requireExactPreviewIdentity({ ...base, clerkMatches: [{ id: 'other', emails: ['source@example.com'] }] }), /do not agree/);
  assert.throws(() => requireExactPreviewIdentity({
    ...base,
    localMatches: [identity({ memberships: [{ locationId: 'loc_other', locationName: 'Other', role: 'MEMBER', connected: true }] })],
  }), /not an active member/);
});

test('source and successor must be different internal identities', () => {
  assert.throws(() => assertOffboardingPair(identity(), identity()), /different users/);
  assert.doesNotThrow(() => assertOffboardingPair(identity(), identity({
    id: 'user_successor', email: 'successor@example.com', clerkId: 'clerk_successor',
  })));
});

test('other memberships remain present for preview reporting', () => {
  const source = identity({ memberships: [
    { locationId: 'loc_active', locationName: 'Active', role: 'ADMIN', connected: true },
    { locationId: 'loc_other', locationName: 'Other', role: 'MEMBER', connected: true },
  ] });
  const resolved = requireExactPreviewIdentity({
    label: 'Source', email: source.email, localMatches: [source],
    clerkMatches: [{ id: 'clerk_source', emails: [source.email] }], activeLocationId: 'loc_active',
  });
  assert.equal(resolved.memberships.length, 2);
});
