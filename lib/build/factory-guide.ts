/**
 * The short "How Build works" shown in Build's settings. The full explainer is documentation/software-factory.md; update
 * both with every factory change. Client-safe: no Node imports.
 */
export const loop: { step: string; who: string; text: string }[] = [
  { step: "Talk", who: "You and the agent", text: "Say what you want. It asks questions, checks the code and proposes small tasks." },
  { step: "Notice", who: "System", text: "The daily review looks at one screen a day, describes it and suggests improvements." },
  { step: "Start", who: "You or autopilot", text: "One tap starts a plan or suggestion; autopilot can start small, safe ones." },
  { step: "Implement", who: "System", text: "Each task runs in its own T3 thread and branch, with a model chosen for its difficulty." },
  { step: "Review", who: "You", text: "Accept, or redo with a note that continues the same thread." },
  { step: "Ship", who: "You", text: "Merge and deploy stay with you." },
];
