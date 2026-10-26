# Studio: the owner's Mac as an optional processing unit

Plan only, written 2026-10-26. Nothing here is built yet. It follows the original brief: hosted processing always works when the Mac is off, the Mac may take scoped local-model work while it is online, providers sit behind adapters, and the operator's Codex/Claude subscriptions are never the customer runtime.

## 1. Which jobs go to the Mac

The jobs that exist today are `studio.transcribe_upload`, `studio.knowledge_extract`, `studio.idea_review`, `studio.script_brief`, `studio.youtube_discovery` and `studio.diagnostic` (`lib/studio/worker/handlers.ts`). The old local app ran transcription on an 8 GB M1 with Parakeet TDT v3 (4-bit, MLX) in `Substo/app/transcribe-local.py`, and it used Codex for text. Codex is not reusable here.

| Job | Where | Why |
| --- | --- | --- |
| `studio.diagnostic` (Worker check) | Mac or hosted | The "hello" job. No models, no spend. |
| `studio.transcribe_upload` | **Mac first**, hosted fallback | Parakeet-MLX is proven on this Mac and is free. It is also the biggest OpenAI cost (whisper-1). |
| Embeddings | Mac later, if needed | Studio has no embeddings today. Add them only when a feature needs them, through the same adapter. |
| `knowledge_extract`, `idea_review`, `script_brief`, onboarding chat | **Hosted (OpenAI)** | These need a strong model and structured output. An 8 GB Mac runs only small 3–4B models (Ollama/MLX), which do this poorly. Revisit if the Mac is upgraded. |
| `youtube_discovery`, scheduled runs | **Hosted** | They use profile-owned Google OAuth on the server and have to run when the Mac is off. |

## 2. How the Mac connects

**Pattern: an outbound-only agent.** A small Node agent (the `scripts/studio-worker.ts` runner, plus local handlers) runs on the Mac under `launchd`. It only makes HTTPS calls to the app: no inbound ports, tunnels or Caddy changes. It is the same runner loop and lease logic as the hosted worker (`lib/studio/worker/runner.ts`), with a different `StudioQueue` implementation that calls the app instead of Supabase.

- **Auth per Business.** A Business admin creates a *Mac device token* in Settings. The token is shown once, stored hashed and revocable, and tied to one Business plus a list of allowed job kinds. The Mac never holds the Supabase service-role key, R2 keys or the Business's OpenAI key.
- **Endpoints.** A few thin Next.js routes, `/api/studio/device/{heartbeat,claim,extend,complete,fail}`, check the token and call the **existing** RPCs (`studio_claim_jobs`, `studio_extend_job_lease`, `studio_complete_job`, `studio_fail_job`, `studio_report_worker`). The jobs, leases, lease tokens, attempts and events are the same. The one SQL change: claim gains optional `business` and `kinds` filters, so a device can only claim its own Business's allowed kinds.
- **Routing.** When a job is enqueued and the Business has a Mac that is *online* (healthy heartbeat under 60 s old, reporting that kind), the job gets `local_until = now + 10 min`. Hosted claims skip a job until `local_until` passes. After that, the hosted worker takes it. If no Mac is online, the job goes straight to hosted. One column and one claim condition; no second queue.
- **Mac sleeps mid-job.** The lease stops renewing and expires (120 s). Then the existing lease-expiry path requeues the job and counts the attempt. On requeue, `local_until` is cleared, so the hosted worker picks the job up next. A Mac that wakes late can't complete it, because its lease token no longer matches. Chunked transcription already resumes from saved chunks.
- **Media.** The claim response carries a short-lived (about 15 min) presigned R2 GET URL for exactly that job's object, made with the existing `media-r2.ts` presigner. The Mac never lists or writes R2. Results come back as JSON in `complete`. The server then applies them through the **same** code that saves a hosted transcript, so there is one write path.
- **Usage.** Local work is free. It records a zero-cost usage row marked `local`, so the Business total stays complete (rule 10) and the reserve/settle step is skipped.

## 3. Testing the connection first

1. **Health indicator.** Studio Settings › AI shows a *Mac* row: online/offline, last seen, release, and the job kinds it accepts. The data comes from `studio_worker_heartbeats`, which already stores handlers, healthy and draining.
2. **Hello job.** A *Run Mac check* button enqueues `studio.diagnostic` with `local_until` set. The Jobs page shows it claimed by `mac:<device>`, with the result `{ ok, workerId, checkedAt }`. With the Mac asleep, the same button shows the hosted worker taking it after the window: that is the fallback test.
3. **By hand:** `curl -H "Authorization: Bearer <token>" https://<app>/api/studio/device/heartbeat` returns `200` for a valid token, and `401` after the token is revoked.

## 4. Slices

| # | Slice | Done when |
| --- | --- | --- |
| 1 | **Device token + heartbeat.** Token create/revoke in Settings, the heartbeat route, and the Mac row. | The Mac shows online within 60 s of the agent starting, offline about 60 s after it stops, and a revoked token gets `401`. |
| 2 | **Hello job end to end.** Scoped claim, the extend/complete/fail routes, `local_until` routing, the Mac agent with only `studio.diagnostic`. | *Run Mac check* succeeds on the Mac when it is online, and on hosted when it is asleep. Another Business's token cannot claim it (SQL test). |
| 3 | **Local transcription.** Parakeet-MLX handler on the Mac, presigned media URL, server applies the result through the existing transcript path, zero-cost `local` usage row. | An uploaded video is transcribed on the Mac with no OpenAI spend. Closing the lid mid-job ends with a hosted transcript and one visible retry. |
| 4 | **Later, on demand.** Embeddings or local text models via Ollama/MLX adapters, only when a feature needs them or the hardware allows it. | Decided per job when it comes up. |

Each slice is deployed with `deploy-local-build.sh` like any other change. The Mac agent ships from this repo.

## Open questions for the owner

1. **One Mac app.** The "Mac network proxy" (decided for later) and this agent should be one Mac app with one sign-in. Agreed?
2. **Which Mac?** Is it still the 8 GB M1? That decides whether local text models are worth it at all.
3. **Who may use it?** Should only your own Business's jobs run on your Mac, or should the Mac also serve other Businesses (e.g. as shared capacity)? The plan assumes your own Business only.
4. **Fallback window.** Is 10 minutes of waiting for the Mac before hosted takes over right, or should urgent jobs skip the Mac?
5. **Local quality.** Parakeet transcripts are English-focused and have no OpenAI fallback check. Is that acceptable for uploads, or should non-English uploads stay hosted?
