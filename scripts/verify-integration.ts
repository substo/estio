
import { runAgent } from '../lib/ai/agent';
import { toolRegistry } from '../lib/ai/mcp/registry';
import { getModelForTask } from '../lib/ai/model-router';

console.log('---------------------------------------------------');
console.log('✅ Agent module loaded successfully');
console.log(`✅ Tool Registry size: ${toolRegistry.length} (Expected 0 if no tools registered yet, or >0 if registered in server.ts side-effects)`);
console.log(`✅ Model for planning: ${getModelForTask('complex_planning')}`);
console.log(`✅ runAgent is a function: ${typeof runAgent === 'function'}`);
console.log('---------------------------------------------------');
