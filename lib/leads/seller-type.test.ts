import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSellerTypeWhereClause,
  isNonPrivateSellerType,
  normalizeProspectSellerType,
  resolveEffectiveSellerType,
  sellerTypeToCompanyType,
  sellerTypeToLegacyAgencyFlag,
} from './seller-type';

test('normalizeProspectSellerType accepts supported values only', () => {
  assert.equal(normalizeProspectSellerType('Agency'), 'agency');
  assert.equal(normalizeProspectSellerType(' management '), 'management');
  assert.equal(normalizeProspectSellerType('unknown'), null);
  assert.equal(normalizeProspectSellerType(null), null);
});

test('resolveEffectiveSellerType prefers manual typed override', () => {
  assert.equal(
    resolveEffectiveSellerType({
      sellerType: 'private',
      sellerTypeManual: 'developer',
      isAgency: false,
      isAgencyManual: null,
    }),
    'developer',
  );
});

test('resolveEffectiveSellerType falls back to legacy boolean manual override', () => {
  assert.equal(
    resolveEffectiveSellerType({
      sellerType: null,
      sellerTypeManual: null,
      isAgency: false,
      isAgencyManual: true,
    }),
    'agency',
  );
  assert.equal(
    resolveEffectiveSellerType({
      sellerType: null,
      sellerTypeManual: null,
      isAgency: true,
      isAgencyManual: false,
    }),
    'private',
  );
});

test('sellerType compatibility mappings are deterministic', () => {
  assert.equal(isNonPrivateSellerType(null), false);
  assert.equal(isNonPrivateSellerType('private'), false);
  assert.equal(isNonPrivateSellerType('other'), true);
  assert.equal(sellerTypeToLegacyAgencyFlag('private'), false);
  assert.equal(sellerTypeToLegacyAgencyFlag('agency'), true);
  assert.equal(sellerTypeToLegacyAgencyFlag('developer'), true);

  assert.equal(sellerTypeToCompanyType('agency'), 'Agency');
  assert.equal(sellerTypeToCompanyType('management'), 'Management');
  assert.equal(sellerTypeToCompanyType('developer'), 'Developer');
  assert.equal(sellerTypeToCompanyType('other'), 'Other');
  assert.equal(sellerTypeToCompanyType('private'), null);
});

test('buildSellerTypeWhereClause emits OR conditions for effective match', () => {
  const clause = buildSellerTypeWhereClause('private') as any;
  assert.ok(Array.isArray(clause.OR));
  assert.ok(clause.OR.length >= 3);
});
