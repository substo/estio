/**
 * The short "How Build works" shown in Build's settings. The full explainer is documentation/software-factory.md; update
 * both with every factory change. Client-safe: no Node imports.
 */
export const loop: { step: string; who: string; text: string }[] = [
  { step: "Talk", who: "You and the agent", text: "Say what you want here or in T3. Open conversations sync in the background. Concrete plans appear as Ready to start task cards in Product." },
  { step: "Notice", who: "System", text: "The daily review looks at one screen a day, describes it and suggests improvements." },
  { step: "Start", who: "You or autopilot", text: "Start a saved plan or task on the page. In T3, a new exact Start or Start it after the saved plan approves it too. Start before a plan only asks for planning; autopilot can start small, safe suggestions." },
  { step: "Implement", who: "System", text: "Started tasks continue their planning conversation and branch. Owner-authorized work already running in T3 can be tracked as external work without starting a duplicate. External reports show progress and evidence, not worker verification or permission to merge or deploy." },
  { step: "Review", who: "You", text: "Each piece of work reads as a short story: what it is, what was achieved, how it works and what is next. Open its conversation from the work card. Read it here or in T3; reply on a returned result to redo the same scoped task." },
  { step: "Ship", who: "You", text: "Accept and merge, then separately approve Deploy current release. Both run in the linked conversation; it handles conflicts and reports verified results." },
];
