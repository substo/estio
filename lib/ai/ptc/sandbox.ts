
import vm from "vm";

/**
 * Execute AI-generated code in a sandboxed environment.
 * The code can call injected tools (as async functions).
 * 
 * @param code - The JavaScript code to execute
 * @param tools - Map of tool names to async functions
 * @param options - Execution options (timeout, etc.)
 */
export async function executePTC(
    code: string,
    tools: Record<string, (...args: any[]) => Promise<any>>,
    options: { timeoutMs?: number } = {}
): Promise<{ result: any; logs: string[]; toolCalls: any[] }> {
    const logs: string[] = [];
    const toolCalls: any[] = [];

    // Create a secure context
    const sandbox = {
        console: {
            log: (...args: any[]) => logs.push(args.map(a => JSON.stringify(a)).join(" ")),
            error: (...args: any[]) => logs.push("ERROR: " + args.map(a => JSON.stringify(a)).join(" ")),
        },
        // Inject tools into the global scope
        ...Object.keys(tools).reduce((acc, toolName) => {
            acc[toolName] = async (...args: any[]) => {
                toolCalls.push({ tool: toolName, args });
                try {
                    return await tools[toolName](...args);
                } catch (e: any) {
                    logs.push(`Tool ${toolName} failed: ${e.message}`);
                    throw e;
                }
            };
            return acc;
        }, {} as Record<string, Function>)
    };

    const context = vm.createContext(sandbox);

    // Wrap the user code in an async IFFE that returns a Promise
    const script = new vm.Script(`
        (async () => {
            ${code}
        })()
    `);

    try {
        // Run the script to get the promise (sync execution is fast, just creating the promise)
        const scriptPromise = script.runInContext(context, {
            displayErrors: true,
            // accessors: true // optional
        });

        // Use Promise.race to enforce timeout on the async operation
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Execution timed out after ${options.timeoutMs || 10000}ms`)), options.timeoutMs || 10000)
        );

        const result = await Promise.race([scriptPromise, timeoutPromise]);

        return { result, logs, toolCalls };
    } catch (e: any) {
        return {
            result: null,
            logs: [...logs, `Execution Error: ${e.message}`],
            toolCalls
        };
    }
}
