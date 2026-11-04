/**
 * Owner-facing guidance for known models (researched 2026-11-03 from public comparisons; see build-workspace.md).
 * Guidance only: a model runs solely after the owner approves it. Unknown/new models show no recommendation.
 */
export type Guidance = { use: string; suggested: "routine" | "hard" | "off" };
export const modelGuidance: Record<string, Guidance> = {
  "claude-sonnet-5-5": { suggested: "routine", use: "Everyday coding. About half Opus's usage, strong on agentic/terminal benchmarks. Runs at T3 default effort (high)." },
  "claude-opus-5-5": { suggested: "hard", use: "Long-running, cross-cutting or ambiguous changes. Runs at T3 default effort (medium)." },
  "claude-haiku-5-5": { suggested: "off", use: "Small bounded steps and summaries. Weak for multi-file changes; at most Routine read-only review." },
  "claude-fable-5-1": { suggested: "off", use: "Slowest, most expensive tier. Last resort when Opus is stuck; not for low-token mode." },
  "gpt-6.1-sol": { suggested: "hard", use: "OpenAI's recommendation for complex coding. Runs at T3 default effort (low)." },
  "gpt-6.1-terra": { suggested: "routine", use: "Mid tier below Sol; stretches Codex allowance further." },
  "gpt-6-astra": { suggested: "off", use: "Top OpenAI tier; uses the most allowance. Only if Sol and Opus are not enough." },
  "gpt-6-luna": { suggested: "off", use: "Budget tier with the weakest coding. Not recommended for Build." },
};
export const unknownGuidance = "New or unreviewed model, no recommendation yet. Approve only after trying it.";
