import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Isolate the two real server action bodies; their auth/data preparation is
// stubbed, while routing/error behavior runs unchanged. No provider can run.
const source = ts.createSourceFile('actions.ts', fs.readFileSync(path.join(process.cwd(), 'app/(main)/admin/conversations/actions.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['generateAIDraft', 'generateComposerAIDraft'];
const actions = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text || ''));
assert.equal(actions.length, 2);
const code = ts.transpileModule(actions.map(node => node.getText(source)).join('\n'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
} }).outputText;

for (const name of names) test(`${name} preserves routing and stops uncertain/empty skill execution without legacy replay`, async () => {
  for (const outcome of ['draft', 'empty', 'failed', 'throw']) {
    let legacyCalls = 0;
    const module = { exports: {} as any };
    vm.runInNewContext(code, { module, exports: module.exports, Date,
      assertCrmActionAllowed: async () => {}, logAIDraftTiming: () => {}, getElapsedMs: () => 0,
      getPendingPasteLeadPropertyImports: async () => [],
      prepareAIDraftRequest: async () => ({ location: { id: 'loc' }, explicitModel: 'selected-model', conversationRecord: { id: 'conv' }, contactRecord: { id: 'contact' } }),
      resolveManualDraftSkillRouting: () => ({ forceSkillId: 'fixture', reason: 'fixture' }),
      normalizeDraftOutputLength: () => 'short', buildConversationalMessagingContract: () => '', getDraftOutputLengthInstruction: () => '',
      runAiSkillDecision: async (args: any) => {
        assert.equal(args.textExecution.model, 'selected-model');
        assert.equal(args.textExecution.executionMode, 'interactive');
        if (outcome === 'throw') throw new Error('uncertain execution');
        return { success: outcome !== 'failed', draftBody: outcome === 'draft' ? 'saved draft' : null, error: outcome === 'failed' ? 'uncertain execution' : undefined };
      },
      generateDraft: async () => { legacyCalls++; return { draft: 'unexpected replay' }; },
    });
    if (outcome === 'draft') assert.equal((await module.exports[name]('conv', 'contact')).draft, 'saved draft');
    else await assert.rejects(module.exports[name]('conv', 'contact'), /uncertain execution|produced no draft/);
    assert.equal(legacyCalls, 0);
  }
});
