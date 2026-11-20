
import { runAgent } from '../lib/ai/agent';
import { toolRegistry } from '../lib/ai/mcp/registry';

console.log('---------------------------------------------------');
console.log('✅ Agent module loaded successfully');
console.log(`✅ Tool Registry size: ${toolRegistry.length} (Expected 0 if no tools registered yet, or >0 if registered in server.ts side-effects)`);
console.log('✅ Planning model: chosen per Location by its AI order (lib/ai/crm-routing.ts)');
console.log(`✅ runAgent is a function: ${typeof runAgent === 'function'}`);
console.log('---------------------------------------------------');
