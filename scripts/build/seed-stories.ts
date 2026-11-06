/**
 * Writes plain-language stories onto Build's Progress records. Dry run by default: reads only, prints what it would do.
 *   node --env-file=.env.prod --import tsx scripts/build/seed-stories.ts            # dry run (read-only)
 *   node --env-file=.env.prod --import tsx scripts/build/seed-stories.ts --apply    # write, after the story code is deployed
 * Work done outside Build without a record is registered with the existing external-work mechanism (trackExternal),
 * one record per piece of work under the orchestrating T3 thread. Existing records only get their story; scope,
 * status and history are left as they are. Re-running is safe: it only replaces stories.
 */
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { externalCommand, externalId, setStory, trackExternal } from "../../lib/build/external";
import { storyInput, type StoryInput } from "../../lib/build/story";
import type { JobSpec } from "../../lib/build/contract";

const orchestrator = "d9a3da99-00a7-473c-93c5-3053312d0661"; // T3 "Persistent AI Project Workflow", which ran these
const library = "73b15758-ef2d-45c2-9055-69d72ce849f6"; // T3 "Improve Studio Research Library"

type Seed = { id: string; story: StoryInput; register?: { key: string; status: "working" | "done"; note: string; evidence: string[]; spec: Omit<JobSpec, "baseRevision" | "endpoint" | "taskType" | "profileId" | "quality" | "tools" | "owner" | "nodeIds"> } };

const seeds: Seed[] = [
  { id: externalId(orchestrator, "business-data"), register: { key: "business-data", status: "done",
    note: "Business data consolidation finished and live: one Business profile, old tables dropped, backups kept.",
    evidence: ["Phases 1 to 6 are in the combined canonical release deployed on 5 November; website settings and both apps' business profiles rendered after the old tables were dropped. Private recovery exports kept."],
    spec: { title: "Business data consolidation", outcome: "Every business fact lives once, in the Business profile, and every reader uses it.", reason: "Business details were scattered and written twice.",
      scope: ["lib/business-profile/", "prisma/migrations/"], acceptance: ["All readers use the Business profile", "Old SiteConfig and Studio key tables dropped with backups kept"] } },
    story: { area: "Business data",
      concept: "Business details were scattered across the Location table, the old SiteConfig table and several settings documents, and were often written twice. This work gathered them into one Business profile.",
      achieved: [
        "One Business profile per business, remembering where each fact came from and whether it was confirmed.",
        "The website, AI, print, settings and Studio all read from it now.",
        "One check for AI connections, with keys stored encrypted only; the plain-text Google key was cleared.",
        "One website settings document instead of several.",
        "The temporary transition switches and double-checks were removed once everything matched.",
        "The old SiteConfig table and Studio's old key table were dropped; backups are kept.",
      ],
      howItWorks: [
        "The Location keeps only the name, domain and time zone.",
        "Everything else reads one flat view of the Business profile, so a fact is written once and shown everywhere.",
      ],
      next: [
        "Move the remaining CRM, Google, Outlook and WhatsApp integration settings out of old Location and User columns.",
        "A CRM password stored in plain text is being investigated.",
      ] } },
  { id: "cmw2e0j33000na4cuvm5tqege", // Build's own first task of the consolidation
    story: { area: "Business data",
      concept: "The first step of the business data consolidation: decide what the one Business profile holds and find every place business details were kept.",
      achieved: [
        "A list of every business detail and where it was stored.",
        "The shape of the Business profile, with tests, that the later steps filled in.",
      ],
      howItWorks: ["Nothing changed for users yet; this step only prepared the new home for business details."],
      next: ["Done; the later steps are in Business data consolidation."] } },
  { id: externalId(orchestrator, "business-onboarding"), register: { key: "business-onboarding", status: "working",
    note: "Onboarding screen is built; research through the paired Mac is in progress and a real research run is still to be verified.",
    evidence: [], spec: { title: "Business onboarding", outcome: "A new business confirms researched facts instead of typing them.", reason: "Filling the Business profile by hand is slow.",
      scope: ["lib/onboarding/", "app/(main)/admin/onboarding/"], acceptance: ["Research fills the Business profile for confirmation", "Locked until a research-capable AI is connected"] } },
    story: { area: "Onboarding",
      concept: "A research-first chat that fills in the Business profile, so the business confirms facts instead of typing them.",
      achieved: [
        "One shared onboarding screen for Estio and Substo, inside the normal app (Admin › Onboarding and Studio › Onboarding).",
        "A timeline of topics beside the chat: Business, Contact, Online presence, Offer, Customers & market, Brand voice, Brand look, Competitors, and Real estate for Estio.",
        "Every value can be edited and shows where it came from and whether it is confirmed.",
        "Opens by itself for admins until finished; Later puts it off for the session; reopen it from Settings › Business profile.",
        "Locked with Connect an AI until the business has an AI that can research.",
        "Paid AI calls are recorded against the business.",
        "Replaces Studio's old setup wizard.",
      ],
      howItWorks: [
        "The owner gives the business name and website, and research starts in the background.",
        "First the website is read without AI, then one research thread per topic runs on the business's own AI.",
        "Research needs a ChatGPT subscription or an OpenAI key with web search; a Gemini key reads the website's pages only; a paired Mac is coming soon.",
        "Suggestions ask, for example, \"Is this your address?\" with Confirm, Edit or Skip.",
        "Free-text answers are understood with one small AI call.",
        "A summary at the end, then Finish.",
      ],
      next: [
        "Research through the paired Mac companion (in progress).",
        "A real research run to check it end to end.",
      ] } },
  { id: externalId(library),
    story: { area: "Studio Library",
      concept: "The Studio Library is where a business keeps the videos, posts and channels it studies. The redesign makes it fill itself in: add a link and the Library fetches the details and writes a short summary.",
      achieved: [
        "Cards look like the original platform, with its thumbnail and link.",
        "Separate views for videos and posts and for watched channels, with platform filters.",
        "Add source: paste a link or @handle and the details are filled in automatically.",
        "Saved sources fill in missing details in the background, a few at a time, without repeating work.",
        "Short AI summaries, kept separate from the business's own research notes.",
        "The first screen shows saved cards first; adding a source opens in a small window.",
        "Live on Estio and Substo since 5 November, checked signed in on desktop and phone.",
      ],
      howItWorks: [
        "Open Studio › Library to browse saved sources by view and platform.",
        "Tap Add source, paste a link or @handle and save; the card appears with its details.",
        "Connected accounts such as YouTube are used first for details, with checks that protect quotas.",
        "Summaries use the person's own ChatGPT or Claude subscription through their paired Mac, only when it has capacity left, and never fall back to a paid API.",
      ],
      next: [
        "Check a real summary end to end on the live app with a paired, running Mac companion.",
        "Check a connected YouTube account on the live app.",
        "Planned: automatic research and channel suggestions.",
      ] } },
  { id: externalId(orchestrator, "build-factory"), register: { key: "build-factory", status: "working",
    note: "Build is live and in daily use; improvements continue from the owner's feedback.",
    evidence: [], spec: { title: "Build (software factory)", outcome: "The owner moves Estio and Substo forward by talking, approving and giving feedback.", reason: "Move the product forward with as little owner effort and attention as possible.",
      scope: ["lib/build/", "app/(main)/admin/platform/build/", "app/api/build/", "scripts/build-worker.ts"], acceptance: ["Conversation-first Build page", "Approved work runs in T3 and comes back for review"] } },
    story: { area: "Build",
      concept: "Build is the owner's private page for moving Estio and Substo forward with little effort: say what you want, the system plans it and does the approved work on the Mac in T3, then shows the result to accept or redo.",
      achieved: [
        "One page: Talk, Needs you, The app, Progress and Playbook, with settings behind one button.",
        "Talk: a planning conversation that ends in tasks you start with one tap.",
        "Each task runs in its own visible T3 thread and branch; a safety check refuses changes outside the agreed files.",
        "The system picks difficulty and model, prefers the subscription with the most allowance left and switches when a limit is hit.",
        "Results show what changed and the choices the agent made; Accept, Redo with a note, or Merge.",
        "An optional daily review suggests up to three improvements and drafts screen descriptions.",
        "A map of every screen, a watch list of outside ideas, and a product memory of decisions.",
        "Work done outside Build is tracked here too, and each card reads as a short story.",
      ],
      howItWorks: [
        "Say what you want in Talk, agree the plan, press Start.",
        "The Mac picks up approved tasks, runs them in T3 and reports back; nothing runs while Build is paused or the Mac sleeps.",
        "Needs you shows only what waits on you, with the decision right there.",
        "Merging is one tap; deploying stays with you.",
      ],
      next: [
        "Learn from feedback: repeated notes become standing guidance (idea, not agreed yet).",
        "Let autopilot approve more once its watching-only judgements look right (idea).",
        "Screenshots on results, so work can be judged from the iPad (idea).",
        "One phone notification when something needs you (deferred).",
      ] } },
];

async function main() {
  const apply = process.argv.includes("--apply");
  for (const s of seeds) storyInput.parse(s.story); // fail before touching anything
  const base = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error("Run from a git checkout");
  const db = new PrismaClient();
  try {
    const control = await db.buildControl.findUnique({ where: { id: "build" } });
    const edited = (control?.worker as { playbook?: { task?: { at?: string } } } | null)?.playbook?.task;
    console.log(`Mode: ${apply ? "APPLY" : "dry run (read-only)"}`);
    console.log(edited ? `Note: the owner edited the "Doing a task" playbook (${edited.at}); its text won't include the new Story request until reset or edited.` : "Doing a task playbook: default text (includes the Story request once deployed).");
    for (const s of seeds) {
      const job = await db.buildJob.findUnique({ where: { id: s.id } });
      const had = (job?.checkpoint as { story?: unknown } | null)?.story ? "replace story" : "add story";
      const action = job ? `${had} on existing ${job.state} record (revision ${job.revision})` : s.register ? `register external-${s.register.status} record, then add story` : "MISSING record; skipped";
      console.log(`\n${s.id}\n  ${s.story.area}: ${action}\n  Concept: ${s.story.concept}\n  ${s.story.achieved.length} achieved · ${s.story.howItWorks.length} how it works · ${s.story.next.length} next`);
      if (!apply || (!job && !s.register)) continue;
      await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(741903211)`;
        if (!job && s.register) {
          const r = s.register;
          await trackExternal(tx, externalCommand.parse({ threadId: orchestrator, key: r.key, status: r.status, note: r.note, evidence: r.evidence,
            spec: { ...r.spec, nodeIds: [], baseRevision: base, endpoint: "review", taskType: "implementation", profileId: "external-t3", quality: 3, tools: ["git-read", "code-write", "test"], owner: "estio-build" } }));
        }
        await setStory(tx, s.id, s.story, "owner");
      });
      console.log("  written");
    }
  } finally { await db.$disconnect(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
