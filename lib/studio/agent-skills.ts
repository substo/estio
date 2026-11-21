import type { AgentSkillName } from "./agent-policy";

/** Procedures the model loads on demand (progressive disclosure). Fixed, bundled text: no tenant data, no permissions, no tools. */
export const AGENT_SKILL_REGISTRY: Record<AgentSkillName, { summary: string; steps: string }> = {
  check_claims: {
    summary: "Verify what a source or the draft claims against saved evidence.",
    steps: "1) List the concrete factual claims in the passage or draft (speaker claims, numbers, results, product capabilities). 2) For each speaker claim, search_source or list_findings for the exact saved wording and cite only observation ids with cite true. 3) Attribute it to the speaker; never restate it as your own fact. 4) Anything about the owner's product, results, customers or the wider world that saved evidence does not support goes in a proposal's verify list. 5) Separate the owner's creative preferences from claims; preferences need no evidence. 6) Say plainly what you could not check.",
  },
  develop_hook_script: {
    summary: "Turn the chosen direction into hook options, then a script.",
    steps: "1) Confirm publisher, viewer and goal from snapshot.decisions or the draft; if one is undecided and matters, ask one question. 2) Offer 2–3 distinct hooks that promise the payoff within the first seconds, each tied to a read passage or finding when it borrows from the source. 3) When a hook is chosen, keep its promise through the Payoff, then draft the Script in spoken, filmable lines. 4) Revisit earlier approved stages instead of contradicting them. 5) Put unverified product or result claims in verify as [VERIFY].",
  },
  plan_shoot: {
    summary: "Turn a script into a practical shoot plan.",
    steps: "1) read_stage Script if it is not fully in the draft. 2) Produce a Shoot plan proposal: setup and location, shot list in script order, on-screen text or screen recordings needed, props the owner must supply, and a filming experiment when comparing two openings (shoot both, same lighting). 3) Use only what the owner has said they have; do not invent equipment, locations or people. 4) Keep it within 1,200 characters; offer to split into two proposals if longer.",
  },
};
export const agentSkillCatalog = (Object.entries(AGENT_SKILL_REGISTRY) as Array<[AgentSkillName, { summary: string }]>).map(([name, s]) => `${name}: ${s.summary}`).join(" ");
