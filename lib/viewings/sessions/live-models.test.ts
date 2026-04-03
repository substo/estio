import assert from "node:assert/strict";
import test from "node:test";
import {
    GEMINI_LIVE_MODELS,
    VIEWING_SESSION_STAGE_MODELS,
    resolveLiveModelForMode,
    resolveViewingSessionStageModelsFromSession,
    resolveViewingSessionStageModelsFromSiteConfig,
} from "@/lib/viewings/sessions/live-models";
import { VIEWING_SESSION_MODES } from "@/lib/viewings/sessions/types";

test("stage model routing falls back to per-stage defaults when overrides are absent", () => {
    const routing = resolveViewingSessionStageModelsFromSiteConfig({
        mode: VIEWING_SESSION_MODES.assistantLiveToolHeavy,
    });

    assert.deepEqual(routing, {
        live: GEMINI_LIVE_MODELS.toolHeavyDefault,
        translation: VIEWING_SESSION_STAGE_MODELS.translationDefault,
        insights: VIEWING_SESSION_STAGE_MODELS.insightsDefault,
        summary: VIEWING_SESSION_STAGE_MODELS.summaryDefault,
    });
});

test("stage model routing preserves configured per-stage overrides independently of live mode", () => {
    const routing = resolveViewingSessionStageModelsFromSession({
        mode: VIEWING_SESSION_MODES.assistantLiveVoicePremium,
        liveModel: "custom-live-model",
        translationModel: "custom-translation-model",
        insightsModel: "custom-insights-model",
        summaryModel: "custom-summary-model",
    });

    assert.deepEqual(routing, {
        live: "custom-live-model",
        translation: "custom-translation-model",
        insights: "custom-insights-model",
        summary: "custom-summary-model",
    });
});

test("live model resolution keeps mode-specific defaults separate", () => {
    assert.equal(
        resolveLiveModelForMode(VIEWING_SESSION_MODES.assistantLiveToolHeavy),
        GEMINI_LIVE_MODELS.toolHeavyDefault
    );
    assert.equal(
        resolveLiveModelForMode(VIEWING_SESSION_MODES.assistantLiveVoicePremium),
        GEMINI_LIVE_MODELS.voicePremiumDefault
    );
});
