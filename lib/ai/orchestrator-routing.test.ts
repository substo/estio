import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'orchestrator.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
}).outputText;

test('orchestrator carries interactive model context into classifier, sentiment, skill and critic without embedding API work', async () => {
  const routing = { model: 'selected-model', executionMode: 'interactive' };
  const captured: any[] = [];
  let embeddingCalls = 0;
  const dependencies: Record<string, any> = {
    '@/lib/db': { contact: { findFirst: async () => ({ locationId: 'loc', location: {} }) },
      user: { findFirst: async () => null } },
    '@/lib/ai/location-google-key': { resolveLocationGoogleAiApiKey: async () => null },
    '@/lib/business-profile/service': { getBusinessViewIfAny: async () => null },
    './classifier': { classifyIntent: async (...args: any[]) => { captured.push(args[3]); return { intent: 'fixture', risk: 'high', suggestedSkill: 'fixture' }; } },
    './sentiment': { analyzeSentiment: async (...args: any[]) => { captured.push(args[2]); return {}; } },
    './tracing': { startTrace: async () => ({ traceId: 'trace' }), startSpan: async () => ({}), endSpan: async () => {}, endTrace: async () => {} },
    './policy': { validateAction: async () => ({ approved: true }) },
    './skills/loader': { SkillLoader: { loadSkill: () => ({ name: 'fixture' }) },
      executeSkill: async (_skill: any, context: any) => { captured.push(context.textExecution); assert.equal(context.memories[0].text, 'saved fact'); return { draftReply: 'draft' }; } },
    './memory': { getContactInsights: async () => [{ text: 'saved fact' }], retrieveContext: async () => { embeddingCalls++; return []; } },
    './reflexion': { reflectOnDraft: async (_draft: string, _history: string, _intent: string, options: any) => { captured.push({ model: options.model, executionMode: options.executionMode }); return 'reviewed'; } },
    './review-gating': { shouldRequireHumanApproval: () => true },
    './prompts/communication-policy': { resolveCommunicationLanguage: () => ({}), inferCommunicationEvidenceFromText: () => ({}), detectLanguageFromText: () => 'en' },
  };
  const module = { exports: {} as any };
  vm.runInNewContext(code, { module, exports: module.exports, console: { log() {} },
    require: (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; },
  });
  const result = await module.exports.orchestrate({ conversationId: 'conv', contactId: 'contact', message: 'fixture', conversationHistory: '', textExecution: routing });
  assert.equal(result.draftReply, 'reviewed');
  assert.equal(embeddingCalls, 0);
  assert.equal(captured.length, 4);
  for (const context of captured) assert.equal(JSON.stringify(context), JSON.stringify(routing));
});
