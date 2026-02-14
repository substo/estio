
import { toolRegistry } from "../mcp/registry";

/**
 * Generates the system prompt addendum for Programmatic Tool Calling.
 * dynamically lists available tools and their signatures.
 */
export function getPtcSystemPrompt(): string {
  const toolSignatures = toolRegistry.map(t => {
    // Simplified signature representation
    // Ideally we'd pretty-print the Zod schema
    return `- ${t.name}(params: ${JSON.stringify(t.inputSchema.properties || {})})`;
  }).join("\n");

  return `
## PROGRAMMATIC TOOL CALLING (PTC) ENABLED

You are capable of executing JavaScript code to accomplish tasks. 
Instead of making single tool calls, you can write a script to orchestrate multiple tools, process data, and handle logic.

### Environment
- Runtime: Node.js (Sandbox)
- Global Objects: console, standard JS built-ins (Math, Date, JSON, etc.)
- Unavailable: require, fs, process, network (except via tools)

### Available Tools (Async Functions)
You can await these functions directly:
${toolSignatures}

### Rules
1. Wrap your code in a \`\`\`javascript block.
2. ALWAYS \`await\` asynchronous tool calls.
3. You can use standard JS logic (loops, if/else, map/filter).
4. Return the final result at the end of the script using the expression or explicit return (if wrapped in function).
5. Do not hallucinate tools. Only use the ones listed above.
6. Use \`console.log\` for debugging or intermediate status.

### Example
\`\`\`javascript
// 1. Searcher Flow
const properties = await search_properties({ locationId: "substo_estio", minPrice: 200000 });
const relevant = properties.filter(p => p.bedrooms >= 3);
if (relevant.length > 0) {
  // Legacy single-step viewing
  await create_viewing({ contactId: context.contactId, propertyId: relevant[0].id, date: "2024-03-10" });
  console.log("Viewing created for " + relevant[0].title);
}

// 2. Coordinator Flow (Phase 4)
const availability = await check_availability({ userId: "user_123", startDate: "2024-03-10", endDate: "2024-03-17" });
if (availability.freeSlots.length > 0) {
  const proposal = await propose_slots({ agentUserId: "user_123", propertyId: relevant[0]?.id });
  // Wait for user selection... then later:
  await confirm_viewing({ 
    viewingId: "v_123", 
    slotStart: proposal.slots[0].start, 
    slotEnd: proposal.slots[0].end, 
    attendees: [{ email: "lead@example.com", name: "Lead Name", role: "lead" }] 
  });
}
return relevant.length;
\`\`\`
`.trim();
}


