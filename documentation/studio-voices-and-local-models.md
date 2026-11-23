# Studio voices, provider keys and local models (design, 2026-11-23)

Owner decisions: nothing provider- or voice-specific lives in `.env`; our own Location uses the product exactly as a customer would; voices are created and chosen in the product; local models are installed from a catalog like Ollama, per task, with detection.

## Decisions

1. **Keys are per Location, in the product.** Fish Audio and ElevenLabs keys are encrypted Location secrets (`settingsService`, `LOCATION_AI` domain, new `FISH_API_KEY` / `ELEVENLABS_API_KEY` secret keys) entered in Settings -> AI beside the OpenAI/Google keys, with the same connection-status and usage rules. No `.env` key, voice id or provider selector is read by any app or companion code. The temporary `.env` block and `lib/studio/video-assembly/tts.ts` env/file reading are removed.
2. **Secrets stay on the server.** Hosted voice generation (Fish, ElevenLabs) runs server-side with the Location's key, never on the Mac and never in a job payload. The Make-video flow first renders the narration beats on the server, stores them as private Studio media, and the Mac job receives download links for `voice-NN.mp3` like footage. On-device voice is the other path: the job carries `{engine:"local", model, voice}` and the Mac generates.
3. **Voice library.** `studio.studio_voices` per Location: provider (`fish`|`elevenlabs`|`local`), provider voice id, display name, kind (`preset`|`clone`), language, optional persona/owner label, default flag, consent record for clones (who, when, statement; sample upload id), created_by. Presets are synced from the provider (Fish `GET /model`, ElevenLabs `GET /v1/voices`); clones are created from an uploaded sample through the provider's clone API (Fish `POST /model`, ElevenLabs `POST /v1/voices/add`) only after an explicit "this is my voice or I have the speaker's permission" attestation, audited. Voices are chosen per piece in Make video, with a Location default; personas/users pick from the same library.
4. **Local models are a catalog, not code.** A reviewed catalog (task, model, repo/revision, size, RAM floor, languages, licence) drives Settings -> Connected computer -> Local models: detected (already on disk), install, remove, status. The Mac companion reports installed models in its heartbeat; install/remove arrive as device commands (same channel as provider login), download with progress, verify, then mark ready. First pairing asks which tasks to run locally and recommends models that fit the reported RAM/disk (8 GB Mac: Qwen3-TTS 0.6B 4-bit, Parakeet). Local use never silently becomes paid use and paid never silently becomes local.
5. **Routing.** Per task (voice, transcription, text) an ordered choice: local model installed on a paired Mac, own Location key, then nothing (no hidden platform key). Shown in the same settings page as the existing AI route.

## Slices

- **Voices (A+B+C):** keys in Settings -> AI, voice library + clone flow, server-side narration, Make-video voice picker, remove env reading.
- **Local models (D+E):** catalog, detection, install/remove commands, Settings UI, first-run prompt.
