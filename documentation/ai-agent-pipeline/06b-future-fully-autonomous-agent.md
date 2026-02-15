# Future Phase: Fully Autonomous Agent (Auto-Pilot)

**Status**: 🔵 Future Concept (Alternative to Phase 6 Semi-Auto)  
**Prerequisites**: Phase 6 (Semi-Auto) must be running stable for 3+ months with >95% acceptance rate of drafts.

---

## Objective

Evolve the **Semi-Auto** system into a **Fully Autonomous** agent ("Auto-Pilot") that can send messages without human approval for low-risk scenarios.

> **Key Difference**: In Semi-Auto (Phase 6), the AI *drafts* everything. In Fully Autonomous, the AI *sends* low-risk messages immediately and only drafts high-risk ones.

---

## 1. Auto-Pilot Architecture

### 1.1 Configuration

A granular configuration controls exactly what the agent is allowed to do autonomously.

```typescript
// lib/ai/auto-pilot/config.ts

interface AutoPilotConfig {
  enabled: boolean;
  
  // Risk thresholds
  maxAutoRisk: "low" | "medium"; // Maximum risk level for auto-actions
  
  // Action whitelist
  allowedAutoActions: {
    acknowledgments: boolean;    // Auto-reply to "thanks", "ok"
    simpleQuestions: boolean;    // Auto-reply to FAQ-like questions
    viewingConfirmation: boolean; // Auto-confirm viewing slots
    followUpReminders: boolean;  // Auto-send follow-up messages
    listingAlerts: boolean;      // Auto-send new listing notifications
  };

  // Safety limits (Circuit Breakers)
  maxAutoRepliesPerDay: number; 
  maxAutoRepliesPerConversation: number;
  cooldownMinutes: number;       // Min time between auto-replies
}
```

### 1.2 Auto-Pilot Guard

Before sending ANY autonomous message, the system MUST pass a rigorous guard check.

```typescript
// lib/ai/auto-pilot/guard.ts

export async function canAutoExecute(
  conversationId: string,
  riskLevel: "low" | "medium" | "high"
): Promise<{ allowed: boolean; reason: string }> {
  
  // 1. Check Global Switch
  if (!config.enabled) return { allowed: false, reason: "Auto-pilot disabled" };

  // 2. Risk Check
  // High risk (negotiations, contracts) is NEVER auto-executed
  if (riskLevel === "high") return { allowed: false, reason: "Risk too high" };
  
  // 3. Rate Limits
  if (todayCount >= limit) return { allowed: false, reason: "Daily limit reached" };

  // 4. Cooldown
  if (justSentMessage) return { allowed: false, reason: "Cooldown active" };

  return { allowed: true, reason: "Passed" };
}
```

---

## 2. Handler Changes (Auto-Sending)

Handlers would be modified to check the Guard and `emit` messages directly if allowed.

```typescript
// lib/ai/events/handlers.ts (Future Autonomous Version)

eventBus.on("message.received", async (event) => {
  // ... orchestrate ...
  const result = await orchestrate({ ... });

  // CHECK: Can we auto-send?
  const guard = await canAutoExecute(conversationId, result.risk);

  if (guard.allowed) {
    // 🚀 AUTO-EXECUTE
    await sendMessage(conversationId, result.draftReply);
    await logAutoAction("auto_sent", result);
  } else {
    // ✋ FALLBACK TO DRAFT (Semi-Auto behavior)
    await storeDraftReply(conversationId, result);
  }
});
```

---

## 3. Risk Classification

The **Intent Classifier** must be upgraded to return a `risk` score for every intent.

| Intent | Risk | Auto-Pilot Eligible? |
|:-------|:-----|:---------------------|
| `GREETING` | Low | ✅ Yes |
| `FAQ_QUESTION` | Low | ✅ Yes |
| `SCHEDULE_VIEWING` | Medium | ⚠️ Configurable |
| `PROVIDE_FEEDBACK` | Medium | ⚠️ Configurable |
| `MAKE_OFFER` | High | ❌ No (Always Draft) |
| `NEGOTIATE_PRICE` | High | ❌ No (Always Draft) |
| `LEGAL_QUESTION` | High | ❌ No (Always Draft) |

---

## 4. UI Dashboard for Autonomy

To manage a fully autonomous fleet, you need a different UI:

1.  **Intervention Rate**: % of auto-pilot actions that were reverted or corrected by a human.
2.  **Sentiment Monitoring**: Alert immediately if a user reacts negatively to an auto-message.
3.  **Kill Switch**: A global "STOP ALL AI" button for emergencies.

---

## 5. Migration Strategy

How to move from Phase 6 (Semi-Auto) to Fully Autonomous:

1.  **Shadow Mode**: Run Auto-Pilot logic but don't send. Log "Would have sent". Compare with human actions.
2.  **Low Risk Only**: Enable Auto-Pilot ONLY for `GREETING` and `FAQ`.
3.  **Gradual Rollout**: Enable for 10% of leads, then 50%, then 100%.
4.  **Full Expansion**: Enable Medium risk intents (Scheduling).

---

**Note**: This document preserves the design work done for the "Auto-Pilot" concept. Implement this ONLY when the Semi-Auto system has proven to be reliable and trustworthy.
