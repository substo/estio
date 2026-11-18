/** Server-owned, transient routing for immediate text work. Never serialize into jobs.
 * Account identity is resolved by the shared LLM from the authenticated request.
 * This does not grant embedding, vision, or tool transport capabilities.
 */
export interface TextExecutionContext {
    model?: string;
    executionMode?: "interactive" | "background";
}
