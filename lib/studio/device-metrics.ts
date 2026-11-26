/** Fixed code-only contract shared by the Mac recorder and the server's capability whitelist. */
export const COMPANION_METRIC_FEATURES = [
  "voice_preview", "voice_clone", "narration", "music", "sound_effects", "transcription", "storyboard",
  "text_turn", "make_video", "video_edit", "open_editor", "mac_check",
] as const;
export type CompanionMetricFeature = typeof COMPANION_METRIC_FEATURES[number];
export const COMPANION_METRIC_UNITS = ["audio_seconds", "media_seconds", "pictures", "tokens"] as const;
export type CompanionMetricUnit = typeof COMPANION_METRIC_UNITS[number];
export const COMPANION_METRIC_STAGES = ["prepare", "narration", "storyboard", "sounds", "assemble", "upload"] as const;
export type CompanionMetricStage = typeof COMPANION_METRIC_STAGES[number];

export interface CompanionMetricSummaryItem {
  feature: CompanionMetricFeature;
  status: "running" | "succeeded" | "failed";
  outcome: string;
  startedAtMs: number;
  durationMs?: number;
  typicalDurationMs?: number;
  unit?: CompanionMetricUnit;
  units?: number;
  ratePerSecond?: number;
  typicalRatePerSecond?: number;
  peakMemoryMb?: number;
  slow?: boolean;
  stages?: Partial<Record<CompanionMetricStage, number>>;
}
