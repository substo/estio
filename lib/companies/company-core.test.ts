import assert from 'node:assert/strict';
import test from 'node:test';

import {
    CompanyAccessDeniedError,
    buildCompanyWhere,
    createCompanyAccessPolicy,
    createCompanyFeedAccessPolicy,
    safeCompanyWebsite,
} from './repository';

const assignedContactWhere = { locationId: 'location-a', assignedUserId: 'user-a' };

function policyFor(userId: string | null, activeLocationId: string | null) {
    const companies = [
        { id: 'company-a', name: 'Shared A', locationId: 'location-a' },
        { id: 'company-b', name: 'Private B', locationId: 'location-b' },
    ];
    return createCompanyAccessPolicy({
        getAuthenticatedUserId: async () => userId,
        getActiveLocationId: async () => activeLocationId,
        findCompanyInLocation: async (companyId, locationId) =>
            companies.find((company) => company.id === companyId && company.locationId === locationId) || null,
    });
}

test('same-location users share the same company scope', async () => {
    for (const userId of ['user-a', 'user-b']) {
        assert.deepEqual(await policyFor(userId, 'location-a').requireCompany('company-a'), {
            userId,
            locationId: 'location-a',
            company: { id: 'company-a', name: 'Shared A', locationId: 'location-a' },
        });
    }
});

test('create context always resolves the server active location', async () => {
    assert.deepEqual(await policyFor('user-a', 'location-a').requireActiveContext(), {
        userId: 'user-a',
        locationId: 'location-a',
    });
});

test('cross-location company IDs are denied for update and delete lookups', async () => {
    await assert.rejects(
        policyFor('user-a', 'location-a').requireCompany('company-b'),
        CompanyAccessDeniedError,
    );
});

test('list search and type filters are combined inside the active location', () => {
    assert.deepEqual(buildCompanyWhere({ locationId: 'location-a', contactVisibilityWhere: assignedContactWhere, q: '  Acme  ', type: 'Developer' }), {
        locationId: 'location-a',
        AND: {
            OR: [
                { name: { contains: 'Acme', mode: 'insensitive' } },
                { email: { contains: 'Acme', mode: 'insensitive' } },
                { phone: { contains: 'Acme', mode: 'insensitive' } },
                { website: { contains: 'Acme', mode: 'insensitive' } },
            ],
        },
        type: 'Developer',
    });
});

test('role filters require a related record in the active location', () => {
    assert.deepEqual(buildCompanyWhere({ locationId: 'location-a', contactVisibilityWhere: assignedContactWhere, hasRole: 'has-properties' }).propertyRoles, {
        some: { property: { locationId: 'location-a' } },
    });
    assert.deepEqual(buildCompanyWhere({ locationId: 'location-a', contactVisibilityWhere: assignedContactWhere, hasRole: 'has-contacts' }).contactRoles, {
        some: { contact: assignedContactWhere },
    });
});

test('only HTTP and HTTPS company websites are linkable', () => {
    assert.equal(safeCompanyWebsite('https://example.com/path'), 'https://example.com/path');
    assert.equal(safeCompanyWebsite('http://example.com'), 'http://example.com/');
    assert.equal(safeCompanyWebsite('javascript:alert(1)'), null);
    assert.equal(safeCompanyWebsite('example.com'), null);
});

test('feed access follows the company active-location boundary', async () => {
    const policy = createCompanyFeedAccessPolicy({
        requireActiveContext: async () => ({ userId: 'user-a', locationId: 'location-a' }),
        findFeedInLocation: async (feedId, locationId) =>
            feedId === 'feed-a' && locationId === 'location-a'
                ? { id: 'feed-a', companyId: 'company-a' }
                : null,
    });

    assert.deepEqual(await policy.requireFeed('feed-a'), {
        userId: 'user-a',
        locationId: 'location-a',
        feed: { id: 'feed-a', companyId: 'company-a' },
    });
    await assert.rejects(policy.requireFeed('feed-b'), CompanyAccessDeniedError);
});
