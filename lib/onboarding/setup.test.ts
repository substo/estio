import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setOwnerField, setFieldState, fieldStatus, factAt, applySuggestions } from './facts';
import { businessView } from '../business-profile/view';
import { researchPrompt, researchFields } from './research-contract';
import { findTopic, topicsFor } from './topics';

test('setup lives in the shared canonical profile and flat view', () => {
  let profile = setOwnerField(null, 'text', 'setup.stage', 'starting', 'owner');
  profile = setOwnerField(profile, 'text', 'setup.kind', 'personal_brand', 'owner');
  profile = setOwnerField(profile, 'text', 'setup.presence', 'online', 'owner');
  assert.deepEqual(businessView(profile, {}).setup, { stage: 'starting', kind: 'personal_brand', presence: 'online' });
  for (const app of ['estio', 'substo'] as const) assert.equal(topicsFor(app)[0].fields[0].key, 'stage');
  assert.throws(() => setOwnerField(profile, 'text', 'setup.stage', 'invalid', 'owner'));
});

test('deferred and excluded fields survive research and can be changed or cleared', () => {
  for (const status of ['not_yet', 'not_applicable'] as const) {
    let profile = setFieldState(null, 'onlinePresence.website', status, 'owner');
    assert.equal(fieldStatus(factAt(profile, 'onlinePresence.website')), status);
    const result = applySuggestions(profile, [{ kind: 'url', path: 'onlinePresence.website', value: 'https://example.com', sources: ['https://example.com'] }], new Date().toISOString());
    assert.equal(result.applied.length, 0);
    profile = setOwnerField(profile, 'url', 'onlinePresence.website', 'https://owner.com', 'owner');
    assert.equal(fieldStatus(factAt(profile, 'onlinePresence.website')), 'confirmed');
    profile = setFieldState(profile, 'onlinePresence.website', 'empty', 'owner');
    assert.equal(fieldStatus(factAt(profile, 'onlinePresence.website')), 'empty');
  }
});

test('research distinguishes starting ventures and excludes owner choices and fields', () => {
  const topic = findTopic('online')!;
  const prompt = researchPrompt(topic, { app: 'substo', webSearch: true, stage: 'starting', kind: 'personal_brand', presence: 'online', excluded: ['website'] });
  assert.match(prompt, /audience, market and comparable brands/);
  assert.doesNotMatch(prompt, /- website \(/);
  assert.match(researchPrompt(topic, { app: 'estio', webSearch: true, stage: 'operating' }), /Look up this existing business/);
  assert.ok(!researchFields(findTopic('business')!).some(f => ['stage', 'kind', 'presence'].includes(f.key)));
});
