# Audio Transcription Provider Research (Google-First Now, Multi-Provider Future)

## Executive Decision (March 2026)

### Decision
- **Now:** Use **Google Gemini models only** for transcription in IDX to minimize implementation complexity and ship fast on existing integrations.
- **Later:** Keep a provider abstraction so OpenAI/Deepgram/AssemblyAI/ElevenLabs/Groq can be added without data-model or UI rework.

### Why this decision is correct for current priorities
- Gemini is already integrated and production-used in IDX (`SiteConfig`, model picker, call wrappers).
- Current objective is best **cost/quality balance** with low delivery risk.
- Workload is mixed: short WhatsApp notes now, long property-viewing recordings over time.
- Multilingual support is required.
- Live translation is desired within ~6 months, but not required for v1 transcription rollout.

## Business Context and Workloads

### Primary workloads
1. **Short-form transcription:** occasional inbound WhatsApp audio notes.
2. **Long-form transcription + extraction:** property-viewing recordings used to extract prospects, requirements, objections, and next actions.

### Planning assumptions
- Monthly audio volume for planning: **10-100 hours/month**.
- Language profile: **multilingual (3+ languages)**.
- Near-term success metric: accurate, fast transcription with low operational complexity.
- Mid-term success metric: structured viewing-note extraction + translation-ready architecture.

## Existing IDX Integration Surface

### Where audio already enters and is persisted
- `lib/whatsapp/evolution-media.ts`
  - Parses WhatsApp audio/image messages and stores media attachment metadata.
  - Writes `MessageAttachment` rows and R2-backed URIs.
- `lib/whatsapp/sync.ts`
  - Normalizes inbound/outbound WhatsApp messages and persists `Message` rows.
- `app/api/webhooks/evolution/route.ts`
  - Webhook entrypoint for incoming WhatsApp events.
  - Calls sync and media ingest paths.
- `app/(main)/admin/conversations/actions.ts`
  - Fetches message data for UI.
  - Already has heavy server action surface for conversation workflows.
- `app/(main)/admin/conversations/_components/message-bubble.tsx`
  - Displays audio attachments in conversation UI.

### Current AI config/control plane already in app
- `app/(main)/admin/settings/ai/actions.ts`
- `app/(main)/admin/settings/ai/ai-settings-form.tsx`
- Existing Gemini-centric model/config path makes Google-first rollout straightforward.

### Queue infrastructure available for async jobs
- `lib/queue/whatsapp-lid-resolve.ts`
- `lib/queue/ghl-sync.ts`
- BullMQ pattern is already established and suitable for async transcription processing.

## Market Research Summary (with Sources)

### Pricing and capability snapshot (as verified March 1, 2026)

| Provider | Published pricing unit | Normalized hourly estimate | Realtime / translation relevance | Recommended role |
|---|---:|---:|---|---|
| **Google Gemini 2.5 Flash-Lite** | Audio input: **$0.30 / 1M tokens** (batch: $0.15) | **$0.0346/hr** (batch: $0.0173/hr) using 32 audio tokens/sec | Live API available; strong path for Google-only prototype | **Primary now (v1)** |
| **Google Gemini 2.5 Flash** | Audio input: **$1.00 / 1M tokens** (batch: $0.50) | **$0.1152/hr** (batch: $0.0576/hr) | Better quality tier than Flash-Lite | Accuracy fallback in Google-only stack |
| **OpenAI gpt-4o-mini-transcribe** | **$0.003/min** (pricing page estimate) | **$0.18/hr** | Strong long-term speech-to-speech and realtime positioning | Primary candidate for future multi-provider phase |
| **Google Cloud STT** | Standard: **$0.016/min**; Dynamic Batch: **$0.003/min** | **$0.96/hr** standard; **$0.18/hr** dynamic batch | Dedicated STT product; dynamic batch is cost-competitive | Optional fallback for dedicated STT features |
| **Deepgram Nova-3** | Multilingual: **$0.0092/min**, Monolingual: $0.0077/min | **$0.552/hr** (multilingual), **$0.462/hr** (mono) | Strong dedicated STT stack incl. streaming | Consider if STT-specialized controls are required |
| **AssemblyAI** | Universal / Universal-Streaming: **$0.15/hr** | **$0.15/hr** | Strong realtime STT and low-latency profile | Strong alternative for streaming STT phase |
| **ElevenLabs Scribe** | API page shows STT starting at **$0.22/hr** (plan-based additional-hour pricing varies) | **~$0.22+/hr** | Strong multilingual voice ecosystem incl. TTS/voice tooling | Consider when high-quality voice output stack is a priority |
| **Groq Whisper** | Whisper Large v3 Turbo: **$0.04/hr**, Whisper Large v3: $0.111/hr | **$0.04-$0.111/hr** | Extremely fast/cheap transcription path | Candidate for bulk low-cost transcription workloads |

### Interpretation
- **Cost leader for this stack today:** Gemini 2.5 Flash-Lite, given tokenized audio pricing and existing implementation footprint.
- **Fastest delivery path:** stay on Gemini first (no new auth/provider surface).
- **Strategic future option:** OpenAI remains high-value for realtime speech-to-speech evolution and mature audio model roadmap.

## Cost Modeling

### Formula
For Gemini token-priced audio:

```text
audio_tokens_per_hour = 32 * 3600 = 115,200
hourly_cost = (115,200 / 1,000,000) * price_per_million_audio_tokens
```

### Scenario table (10h / 50h / 100h monthly)

| Option | Hourly cost (USD) | 10h / month | 50h / month | 100h / month |
|---|---:|---:|---:|---:|
| Gemini 2.5 Flash-Lite (standard, $0.30/M audio tokens) | 0.0346 | 0.35 | 1.73 | 3.46 |
| Gemini 2.5 Flash-Lite (batch, $0.15/M audio tokens) | 0.0173 | 0.17 | 0.86 | 1.73 |
| Gemini 2.5 Flash (standard, $1.00/M audio tokens) | 0.1152 | 1.15 | 5.76 | 11.52 |
| OpenAI gpt-4o-mini-transcribe benchmark ($0.003/min) | 0.18 | 1.80 | 9.00 | 18.00 |

### Important cost caveat
- These figures are **transcription-only**.
- Downstream tasks (summarization, extraction, CRM note generation, translation) add model token costs and should be tracked separately.

## Recommended Google-First Architecture (Now)

### Phase 1: Async transcript generation for inbound audio
- Trigger async transcription after audio `MessageAttachment` is stored.
- Store transcript text + metadata (provider/model/language/cost/status/error).
- Show transcript under each audio message in conversation UI.

### Phase 2: Long-audio viewing-note extraction
- Add extraction action for long transcripts to produce structured fields:
  - prospects
  - requirements
  - budget
  - preferred locations
  - objections
  - next actions
- Save extracted output into CRM log/contact history workflow.

### Phase 3: Optional near-realtime translation prototype (Google-only)
- Use Gemini Live API for low-latency audio session experiments.
- Keep this behind feature flags due to session and modality constraints.

### Expected operational behavior
1. Auto-transcribe inbound audio.
2. Persist transcript + metadata for analytics and retries.
3. Render transcript in conversation thread.
4. Support **Regenerate transcript** action.
5. Support **Extract viewing notes** action for long recordings.

## Future Options and Trigger Points

### Provider switch matrix

| Add provider when... | Why switch | Target provider |
|---|---|---|
| Realtime speech-to-speech latency/quality becomes top priority | Strong production voice model path and realtime tooling | OpenAI |
| Advanced streaming STT controls become mandatory | Dedicated STT vendors with richer STT-first features | Deepgram / AssemblyAI |
| Cost pressure dominates for bulk transcription | Very low per-hour ASR pricing for Whisper variants | Groq |
| Voice output quality and voice tooling become core product differentiator | Strong TTS/voice stack around STT | ElevenLabs |

### Trigger criteria examples
- WER or transcript quality target is consistently missed on core languages.
- Translation latency SLA is not met for live conversation scenarios.
- Monthly transcription+processing budget exceeds agreed threshold.
- Needed feature is unavailable in current Google-only implementation (for example, provider-specific diarization or enterprise controls).

## Proposed Interfaces and Data Model (Implementation-Ready Spec)

> Spec only for future implementation; no code changes are applied here.

### Public types

```ts
type TranscriptionProvider =
  | "google"
  | "openai"
  | "deepgram"
  | "assemblyai"
  | "elevenlabs"
  | "groq";

type TranscriptionJobRequest = {
  messageId: string;
  attachmentId: string;
  locationId: string;
  languageHint?: string;
  priority?: "normal" | "high";
};

type TranscriptionResult = {
  text: string;
  language?: string;
  durationSec?: number;
  confidence?: number;
  segments?: Array<{
    startSec: number;
    endSec: number;
    text: string;
    speaker?: string;
  }>;
  provider: TranscriptionProvider;
  model: string;
  costUsd?: number;
};

type ViewingNotesExtraction = {
  prospects: string[];
  requirements: string[];
  budget: string | null;
  locations: string[];
  objections: string[];
  nextActions: string[];
};
```

### Persistence spec (proposed)
- Add transcript entity linked to `Message` and `MessageAttachment`.
- Required fields:
  - `status` (`pending | processing | completed | failed`)
  - `provider`
  - `model`
  - `language`
  - `text`
  - `segments` (JSON, optional)
  - `costUsd` (optional)
  - `error` (optional)
  - timestamps

## Test Scenarios and Acceptance Criteria

1. **Short WhatsApp audio**
   - Transcript is generated and appears in conversation UI.
   - Status transitions are visible (`pending -> processing -> completed`).
2. **Long property-viewing audio**
   - Transcription runs asynchronously and does not block webhook handling.
   - Extraction action returns structured `ViewingNotesExtraction` output.
3. **Failure and retry**
   - Failed jobs are marked with reason.
   - Retry succeeds without duplicate transcript rows.
4. **Access control**
   - Only users with same location access can read transcript content.
5. **Observability**
   - Provider/model/cost/status are persisted and queryable for monthly reporting.
6. **Cost sanity checks**
   - Aggregated monthly totals align with expected pricing formulas.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Long audio spikes queue latency | Delayed transcript availability | Prioritized queue tiers + worker concurrency tuning |
| Multilingual audio quality variance | Inconsistent extraction quality | Language hinting + fallback model strategy within Google tiers |
| Realtime session limits in Live API | Session interruption in translation prototype | Session resumption/chunking strategy and feature-flag rollout |
| Attachment/transcript mismatch | Incorrect UI rendering or retries | Strong FK links and idempotent job keys per attachment |
| Underestimated total cost (post-processing) | Budget drift | Separate metering for transcription vs extraction/summarization |

## Appendix: Source Links

### OpenAI
- [OpenAI Pricing](https://openai.com/api/pricing/)
- [OpenAI Platform Pricing](https://platform.openai.com/pricing)
- [OpenAI Speech-to-Text guide](https://platform.openai.com/docs/guides/speech-to-text)
- [OpenAI audio model announcement](https://openai.com/index/introducing-our-next-generation-audio-models/)

### Google
- [Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Gemini token counting (audio tokens/sec)](https://ai.google.dev/gemini-api/docs/tokens)
- [Gemini audio understanding docs](https://ai.google.dev/gemini-api/docs/audio)
- [Gemini Live API guide](https://ai.google.dev/gemini-api/docs/live-guide)
- [Google Cloud Speech-to-Text pricing](https://cloud.google.com/speech-to-text/pricing)

### Other providers
- [Deepgram pricing](https://deepgram.com/pricing)
- [AssemblyAI pricing](https://www.assemblyai.com/pricing)
- [AssemblyAI models/pricing reference](https://www.assemblyai.com/docs/getting-started/models)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [Groq pricing](https://groq.com/pricing)
- [Groq speech-to-text docs](https://console.groq.com/docs/speech-to-text)

---

**Note on source interpretation:** Some provider pages show plan-specific included usage and additional-usage pricing separately. Where this occurs, this document uses normalized entry-level/starting rates for comparison and flags plan variance explicitly.
