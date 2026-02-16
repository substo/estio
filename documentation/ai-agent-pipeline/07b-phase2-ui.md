# Phase 2: UI — Learning Interface in Coordinator Panel

> Part of the [Learning Engine](./07-learning-engine.md) architecture.
> **Status**: Planned
> **Depends on**: [Phase 1](./07a-phase1-foundation.md)

## Overview

Phase 2 adds the user-facing interface for the Learning Engine. After this phase, users can trigger analysis, review proposals, and apply improvements — all from the Coordinator Panel.

---

## 1. Server Actions

### File: `app/(main)/admin/conversations/actions.ts`

Add the following server actions:

```typescript
// ── LEARNING ENGINE ACTIONS ──

/**
 * Trigger the Learning Agent to analyze a conversation.
 * Returns a LearningSession with proposals.
 */
export async function analyzeConversationAction(conversationId: string) {
    const location = await getAuthenticatedLocation();
    // ... resolve conversation, fetch messages
    // Call learning-agent.ts → analyzeConversation()
    // Return { session, proposals }
}

/**
 * Analyze a pasted transcript (phone call, external chat, etc.)
 */
export async function analyzeTranscriptAction(text: string) {
    // Call learning-agent.ts → analyzeTranscript()
    // Return { session, proposals }
}

/**
 * Apply a single learning proposal.
 * Creates the DynamicIntent / PlaybookEntry in the DB.
 */
export async function applyProposalAction(proposalId: string) {
    // Call learning-agent.ts → applyProposal()
    // Return { success }
}

/**
 * Dismiss a learning proposal.
 */
export async function dismissProposalAction(proposalId: string) {
    await db.learningProposal.update({
        where: { id: proposalId },
        data: { status: "rejected" }
    });
    return { success: true };
}

/**
 * Get learning history for a conversation or all.
 */
export async function getLearningSessionsAction(conversationId?: string) {
    // Fetch LearningSession records with proposals
    // Return sorted by createdAt desc
}

/**
 * Get all active dynamic intents and playbook entries (for admin view).
 */
export async function getDynamicConfigAction() {
    // Return { intents: DynamicIntent[], playbook: PlaybookEntry[] }
}
```

---

## 2. UI: Coordinator Panel Updates

### Modified File: `coordinator-panel.tsx`

Add the "Learn from This" button and learning results display.

### New State Variables

```typescript
// Learning Engine State
const [learning, setLearning] = useState(false);
const [learningResult, setLearningResult] = useState<any>(null);
const [applyingProposal, setApplyingProposal] = useState<string | null>(null);
const [transcriptMode, setTranscriptMode] = useState(false);
const [transcriptText, setTranscriptText] = useState("");
```

### Button Placement

The "Learn from This" button goes next to the existing "Orchestrate (Smart Agent)" button in the "Initialize Agent" section:

```tsx
{/* PHASE 1 ORCHESTRATOR BUTTON */}
<Button onClick={handleOrchestrate} ...>
    Orchestrate (Smart Agent)
</Button>

{/* LEARNING ENGINE BUTTON */}
<Button
    onClick={handleLearn}
    disabled={learning}
    className="w-full bg-amber-600 hover:bg-amber-700 text-white"
>
    {learning ? <Loader2 /> : <BookOpen />}
    Learn from This Conversation
</Button>

{/* Transcript option */}
<Button
    variant="ghost"
    size="sm"
    onClick={() => setTranscriptMode(!transcriptMode)}
>
    Or paste a phone call transcript...
</Button>
```

### Handler Functions

```typescript
const handleLearn = async () => {
    setLearning(true);
    setLearningResult(null);
    try {
        const res = await analyzeConversationAction(conversation.id);
        setLearningResult(res);
    } catch (e: any) {
        setError("Learning analysis failed: " + e.message);
    } finally {
        setLearning(false);
    }
};

const handleLearnFromTranscript = async () => {
    if (!transcriptText.trim()) return;
    setLearning(true);
    try {
        const res = await analyzeTranscriptAction(transcriptText);
        setLearningResult(res);
    } catch (e: any) {
        setError("Transcript analysis failed: " + e.message);
    } finally {
        setLearning(false);
    }
};

const handleApplyProposal = async (proposalId: string) => {
    setApplyingProposal(proposalId);
    try {
        await applyProposalAction(proposalId);
        // Update local state to reflect applied status
        setLearningResult(prev => ({
            ...prev,
            proposals: prev.proposals.map(p => 
                p.id === proposalId ? { ...p, status: "applied" } : p
            )
        }));
        toast({ title: "Applied", description: "Knowledge applied successfully." });
    } catch (e: any) {
        toast({ title: "Failed", description: e.message, variant: "destructive" });
    } finally {
        setApplyingProposal(null);
    }
};
```

---

## 3. Learning Results Component

### New File: `learning-results.tsx`

A dedicated component for rendering the analysis output:

```tsx
interface LearningResultsProps {
    result: {
        session: LearningSession;
        proposals: LearningProposal[];
        coverageAnalysis: {
            messagesAnalyzed: number;
            wellHandled: number;
            gapsFound: number;
            gapDetails: { messageIndex: number; message: string; issue: string }[];
        };
    };
    onApply: (proposalId: string) => void;
    onDismiss: (proposalId: string) => void;
    applyingId: string | null;
}
```

### Visual Layout

```
┌──────────────────────────────────────────────┐
│ 📊 Coverage Analysis                         │
│ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
│ 8 messages analyzed                          │
│ ████████████░░░░ 6/8 well handled (75%)      │
│                                              │
│ ⚠️ 2 gaps identified:                        │
│ • Msg #3: "My friend is looking..." → No     │
│   REFERRAL intent exists                     │
│ • Msg #7: "What about financing?" → Missing  │
│   guidance in skill                          │
├──────────────────────────────────────────────┤
│ 💡 Proposals (2)                             │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 🏷️ NEW INTENT                            │ │
│ │ Add "REFERRAL" intent                    │ │
│ │ Risk: low • Skill: lead_qualification    │ │
│ │ ─────────────────────────────────────── │ │
│ │ 2 few-shot examples included             │ │
│ │                                          │ │
│ │ [✅ Apply]  [❌ Dismiss]  [👁️ Preview]   │ │
│ └──────────────────────────────────────────┘ │
│                                              │
│ ┌──────────────────────────────────────────┐ │
│ │ 📚 PLAYBOOK ENTRY                        │ │
│ │ Financing question response template     │ │
│ │ Category: strategy • Priority: 7/10      │ │
│ │ ─────────────────────────────────────── │ │
│ │ "When asked about financing: 1) Ack..."  │ │
│ │                                          │ │
│ │ [✅ Apply]  [❌ Dismiss]  [👁️ Preview]   │ │
│ └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

### Proposal Type Badges

| Type | Badge Color | Icon |
|------|-------------|------|
| `new_intent` | Indigo | 🏷️ |
| `playbook_entry` | Amber | 📚 |
| `policy_rule` | Red | 🛡️ |
| `skill_amendment` | Purple | ⚡ |
| `few_shot_example` | Green | 📝 |

### Status States

| Status | Visual |
|--------|--------|
| `pending` | Show Apply/Dismiss buttons |
| `applied` | Green checkmark, greyed out card |
| `rejected` | Strikethrough, muted card |

---

## 4. Transcript Input UI

When the user clicks "Or paste a phone call transcript...", expand a textarea:

```tsx
{transcriptMode && (
    <div className="space-y-2 bg-amber-50/50 border border-amber-100 rounded-md p-3">
        <label className="text-[11px] text-amber-800 font-semibold uppercase">
            Paste Transcript
        </label>
        <Textarea
            value={transcriptText}
            onChange={(e) => setTranscriptText(e.target.value)}
            placeholder="Paste phone call transcript, external chat log, or any text..."
            className="min-h-[120px] text-sm font-mono bg-white"
        />
        <Button
            onClick={handleLearnFromTranscript}
            disabled={!transcriptText.trim() || learning}
            className="bg-amber-600 hover:bg-amber-700 text-white"
            size="sm"
        >
            {learning ? <Loader2 className="w-3 h-3 animate-spin mr-2" /> : <Sparkles className="w-3 h-3 mr-2" />}
            Analyze Transcript
        </Button>
    </div>
)}
```

---

## 5. Learning History in Trace Modal

Add a "Learning" tab to the existing Trace Modal that shows past learning sessions:

- List of `LearningSession` records for this conversation
- Each shows: date, proposals count, applied count
- Click to expand and see proposal details
- Links to the DynamicIntent/PlaybookEntry records that were created

---

## Verification

After implementing Phase 2:

1. Open a conversation with a scenario not covered by existing intents
2. Click "Learn from This Conversation" 
3. Verify the coverage analysis renders correctly
4. Verify proposal cards appear with type badges
5. Click "Apply" on a proposal
6. Verify a toast confirms application
7. Open the Trace Modal → verify the learning session appears in history
8. Test the "Paste Transcript" flow with a phone call transcript
9. Navigate away and return — verify the learning session is persisted

---

## Files Changed

| Action | File |
|--------|------|
| MODIFY | `app/(main)/admin/conversations/actions.ts` |
| MODIFY | `app/(main)/admin/conversations/_components/coordinator-panel.tsx` |
| NEW | `app/(main)/admin/conversations/_components/learning-results.tsx` |
