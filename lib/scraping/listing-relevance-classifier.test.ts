import test from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyListingRelevance,
    classifyListingRelevanceWithRules,
} from './listing-relevance-classifier';

test('rule classifier marks clear real-estate listings as real_estate', () => {
    const decision = classifyListingRelevanceWithRules({
        externalId: 'r1',
        title: 'Office ready to move in',
        description: 'Commercial office in Paphos with 120 sq.m',
        url: 'https://www.bazaraki.com/real-estate/commercial/adv/1_office-ready/',
        listingType: 'sale',
        bedrooms: 0,
        bathrooms: 1,
        propertyArea: 120,
    });

    assert.equal(decision.isRealEstate, true);
    assert.equal(decision.source, 'rule');
    assert.equal(decision.uncertain, false);
});

test('rule classifier does not false-match "cargo" as "car"', () => {
    const decision = classifyListingRelevanceWithRules({
        externalId: 'r2',
        title: '2 pairs of grey school cargo shorts - age 12/13',
        description: 'Clothes bundle',
        url: 'https://www.bazaraki.com/adv/2_cargo-shorts/',
        listingType: 'sale',
    });

    assert.equal(decision.reason.includes('negative terms: car'), false);
});

test('uncertain listing fail-closes when AI is unavailable', async () => {
    const decision = await classifyListingRelevance(
        {
            externalId: 'r3',
            title: 'Led panel ceiling light',
            description: '',
            url: 'https://www.bazaraki.com/adv/3_led-panel-ceiling-light/',
            listingType: 'sale',
        },
        undefined,
        { disableAI: true, forceReclassify: true },
    );

    assert.equal(decision.isRealEstate, false);
    assert.equal(decision.source, 'fallback');
    assert.equal(decision.diagnosticCode, 'ai_unavailable_fail_closed');
});

test('cached v2 relevance decision is reused unless forceReclassify is set', async () => {
    const cached = {
        'System listing relevance': 'real_estate',
        'System listing relevance confidence': '91',
        'System listing relevance source': 'rule',
        'System listing relevance reason': 'cached',
        'System listing relevance checked at': '2026-03-23T00:00:00.000Z',
        'System listing relevance version': 'v2',
        'System listing relevance diagnostic code': 'none',
        'System listing relevance ai attempted': 'false',
        'System listing relevance ai attempts': '0',
    };

    const reused = await classifyListingRelevance(
        {
            externalId: 'r4',
            title: 'Fridge',
            description: '',
            url: 'https://www.bazaraki.com/adv/4_fridge/',
            listingType: 'sale',
        },
        cached,
    );
    assert.equal(reused.source, 'cached');
    assert.equal(reused.isRealEstate, true);

    const forced = await classifyListingRelevance(
        {
            externalId: 'r5',
            title: 'Fridge',
            description: '',
            url: 'https://www.bazaraki.com/adv/5_fridge/',
            listingType: 'sale',
        },
        cached,
        { forceReclassify: true, disableAI: true },
    );
    assert.notEqual(forced.source, 'cached');
    assert.equal(forced.isRealEstate, false);
});
