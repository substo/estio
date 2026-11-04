/**
 * "How it works" for the software factory, rendered on Build's How it works tab and mirrored in
 * documentation/software-factory.md. Update both with every factory change. Client-safe: no Node imports.
 */
export type Status = "live" | "record-only" | "planned" | "owner";
export type Capability = { name: string; status: Status; what: string; system: string; you: string; where: string };

export const factoryIntro = "Build moves Estio and Substo forward with as little of your attention as possible. The system notices, proposes, routes and does approved work in visible T3 threads. You give feedback and keep the gates for merge, deploy and approving models.";

export const loop: { step: string; who: string; text: string }[] = [
  { step: "Notice", who: "System", text: "The daily review checks one screen a day and drafts its description; updated watch-list items go first." },
  { step: "Propose", who: "System", text: "Findings become cards with difficulty and model chosen automatically." },
  { step: "Approve", who: "You or policy", text: "One click, or policy auto-approval for small Routine work." },
  { step: "Implement", who: "System", text: "A T3 thread works on its own branch; the fence checks every change." },
  { step: "Review", who: "You", text: "Accept, or redo with a note that continues the same thread." },
  { step: "Ship", who: "You", text: "Merge and deploy stay manual." },
];

export const capabilities: Capability[] = [
  { name: "Experience map", status: "live", what: "The app as users see it: section › area › screen, from the app's routes. Code files stay attached as evidence.", system: "Derives screens and marks those affected by a code change stale.", you: "Rename screens or add features if you want.", where: "Product map" },
  { name: "Daily review", status: "live", what: "A read-only look at one screen per day, prioritising screens linked to an updated watch-list item.", system: "Picks the screen and writes up to three proposals.", you: "Turn it on once.", where: "Decisions & work" },
  { name: "Findings become proposals", status: "live", what: "Every review ends with up to three structured proposals that appear as unapproved cards.", system: "Validates them, decides difficulty and model, closes the daily review.", you: "Approve the ones you want.", where: "Decisions & work" },
  { name: "Difficulty and model choice", status: "live", what: "Routine or Hard from files, sensitive areas, dependents and criteria; then an approved model at that level, with fallback when a limit is hit.", system: "Everything.", you: "Nothing.", where: "Shown on each card" },
  { name: "Policy auto-approval", status: "record-only", what: "Small Routine implementation (3 files or fewer, no sensitive area, 5 criteria or fewer) up to 3 a day. Starts as record-only: cards show what the policy would do.", system: "Judges each new card.", you: "Choose Off, Record only or On.", where: "How it works › Your setup" },
  { name: "T3 execution", status: "live", what: "Each approved card becomes a visible T3 thread on a build/… branch. Starting it costs no tokens.", system: "Starts, watches and stops threads.", you: "Watch, steer or answer in T3 if you like.", where: "T3 Code sidebar" },
  { name: "Safety fence", status: "live", what: "Only approved files may change; no commits, symlinks or secrets. Read-only work must change nothing.", system: "Verifies every result.", you: "Nothing.", where: "Card evidence" },
  { name: "Feedback and redo", status: "live", what: "Accept, or write what should change. A redo sends only your note to the same thread, keeping context and tokens low.", system: "Re-approves the same scope and continues the thread.", you: "Accept or write a note.", where: "Result cards" },
  { name: "Approved models", status: "live", what: "Models come from T3's live catalog; new ones appear as Not allowed.", system: "Keeps the list current.", you: "Allow models once, as Routine or Hard.", where: "Model profiles" },
  { name: "Watch list", status: "live", what: "Repos, apps, videos and features to learn from, linked to screens. GitHub repos are checked daily for updates.", system: "Checks for updates and feeds them to the daily review.", you: "Paste links; mark adopted or not for us.", where: "Watch list" },
  { name: "Screen descriptions", status: "live", what: "While reviewing a screen, the daily review also drafts what it is for, the user journey and up to 5 features. Undescribed screens go first.", system: "Drafts one screen a day in the same review run, so no extra tokens.", you: "Confirm (features are added) or discard.", where: "Product map" },
  { name: "For you (attention queue)", status: "live", what: "Build opens on only what needs you, one at a time: blocked work, questions in T3, results, proposals, screen drafts, watch-list updates, setup gaps.", system: "Collects and orders everything; hides the rest.", you: "Act on the item shown, or choose Later.", where: "For you" },
  { name: "Merge and deploy", status: "owner", what: "Results stay on branches until you merge and deploy.", system: "Never merges or deploys.", you: "Merge and deploy.", where: "Git / deploy-local-build.sh" },
];

export const statusLabel: Record<Status, string> = { live: "Live", "record-only": "Record only", planned: "Planned", owner: "Stays with you" };
