import { stdin } from "node:process";
import { createLocalTextAdapter, modelPattern } from "../lib/studio/companion/providers";

async function main() {
  const [provider, model, action] = process.argv.slice(2);
  if ((provider !== "codex" && provider !== "claude") || !model || !modelPattern.test(model)) {
    throw new Error("Choose Codex or Claude Code and an explicit model ID.");
  }
  const adapter = createLocalTextAdapter(provider);
  if (action === "status") {
    const readiness = await adapter.readiness(undefined, { listModels: true });
    if (!readiness.ready) throw new Error("The native CLI needs an active subscription sign-in. API-key and Console logins are excluded.");
    console.log(JSON.stringify({ models: readiness.models }));
    return;
  }

  const buffers = [];
  let size = 0;
  for await (const chunk of stdin) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Comment analysis request is too large.");
    buffers.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(buffers).toString("utf8"));
  if (typeof request.prompt !== "string" || !request.schema || typeof request.schema !== "object") {
    throw new Error("Invalid comment analysis request.");
  }
  const value = await adapter.generate({
    model, prompt: request.prompt, jsonSchema: request.schema, signal: AbortSignal.timeout(180_000),
    timeoutMs: 150_000, maxResultBytes: 20 * 1024, validate: value => value,
  });
  console.log(JSON.stringify(value));
}

main().catch(error => {
  const reason = error instanceof Error ? error.message : "";
  console.error(reason === "provider_not_ready" ? "The chosen native subscription is unavailable." :
    reason.includes("subscription sign-in") ? reason : "The chosen subscription did not return a valid result.");
  process.exitCode = 1;
});
