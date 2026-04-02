import assert from "node:assert/strict";
import test from "node:test";
import {
    deriveViewingSessionAnalysisStatus,
    VIEWING_SESSION_ANALYSIS_STATUSES,
    VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES,
    VIEWING_SESSION_TRANSLATION_STATUSES,
} from "@/lib/viewings/sessions/types";

test("derived analysisStatus tracks translation+insight pipeline status", () => {
    assert.equal(
        deriveViewingSessionAnalysisStatus({
            translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.pending,
            insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending,
        }),
        VIEWING_SESSION_ANALYSIS_STATUSES.pending
    );
    assert.equal(
        deriveViewingSessionAnalysisStatus({
            translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.processing,
            insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.pending,
        }),
        VIEWING_SESSION_ANALYSIS_STATUSES.processing
    );
    assert.equal(
        deriveViewingSessionAnalysisStatus({
            translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.completed,
            insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.completed,
        }),
        VIEWING_SESSION_ANALYSIS_STATUSES.completed
    );
    assert.equal(
        deriveViewingSessionAnalysisStatus({
            translationStatus: VIEWING_SESSION_TRANSLATION_STATUSES.completed,
            insightStatus: VIEWING_SESSION_INSIGHT_PIPELINE_STATUSES.failed,
        }),
        VIEWING_SESSION_ANALYSIS_STATUSES.failed
    );
});
