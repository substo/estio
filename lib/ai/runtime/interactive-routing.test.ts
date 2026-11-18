import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import test from 'node:test';
import ts from 'typescript';

// Execute the actual queue/finalization paths with an isolated database. No
// provider, credentials, production database or runtime scheduler is loaded.
const source = fs.readFileSync(path.join(__dirname, 'engine.ts'), 'utf8')
  + '\nexport { queueDecisionAndJob, processClaimedRuntimeJob };';
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
} }).outputText;
function fixture() {
  const writes: any[] = [];
  const db = {
    aiDecision: {
      create: async (input: any) => ({ id: 'decision', status: input.data.status }),
      updateMany: async () => ({ count: 1 }), update: async () => ({}),
    },
    aiRuntimeJob: {
      create: async (input: any) => { writes.push(input.data); return { id: 'job' }; },
      update: async (input: any) => { writes.push(input.data); return {}; },
    },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(code, { module, exports: module.exports, console, Date,
    require: (name: string) => name === 'crypto' ? crypto : name === '@/lib/db' ? db : {},
  });
  return { ...module.exports, writes };
}
const now = new Date('2026-11-18T10:00:00Z');
const job = (interactive: boolean) => ({ id: 'job', decisionId: 'decision', attemptCount: 0,
  maxAttempts: 6, payload: interactive ? { interactiveTextOnly: true } : {}, decision: null });

test('a background claimant stops interactive work before reading skills or calling providers', async () => {
  const f = fixture();
  assert.equal(await f.processClaimedRuntimeJob(job(true), now), 'dead');
  assert.equal(f.writes[0].status, 'dead');
  assert.match(f.writes[0].lastError, /background provider fallback is blocked/);
});

test('failed interactive execution cannot become a background retry; automation retains retries', async () => {
  const f = fixture();
  assert.equal(await f.processClaimedRuntimeJob(job(true), now, { model: 'chosen', executionMode: 'interactive' }), 'dead');
  assert.match(f.writes[0].lastError, /no decision payload/);
  assert.equal(await f.processClaimedRuntimeJob(job(false), now), 'retry');
  assert.equal(f.writes[1].status, 'pending');
});

test('interactive queue persists only a routing fence and allows one attempt', async () => {
  for (const interactiveTextOnly of [true, false]) {
    const f = fixture();
    await f.queueDecisionAndJob({ locationId: 'loc', conversationId: 'conv', contactId: 'contact',
      source: 'manual', selectedPolicy: { id: 'policy', skillId: 'skill', objective: 'nurture', version: 1 },
      evaluation: { holdReason: null, score: 1, scoreBreakdown: {} }, now,
      contextSummary: 'fixture', interactiveTextOnly,
    });
    assert.equal(f.writes[0].maxAttempts, interactiveTextOnly ? 1 : 6);
    assert.deepEqual(Object.keys(f.writes[0].payload).sort(), interactiveTextOnly
      ? ['contextSummary', 'extraInstruction', 'interactiveTextOnly'] : ['contextSummary', 'extraInstruction']);
  }
});
