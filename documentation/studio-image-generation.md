# Storyboard images: platforms, models and prompts

Status (2026-11-25): the catalog, prompt builder, platform clients, key storage and the Settings → AI → Images card are built. The storyboard itself (a frame for each beat without footage, drawn from the creator's photo, reviewed before use) is the next step and is not built yet. Nothing is generated until an owner chooses a model and presses Test or Generate.

## Where it lives

All provider keys live on **Settings → AI → Connections** (`/settings/ai/connections`): one uniform card per platform, a masked key with a Connected check, Check connection and Remove when connected, only the key box when not. On each connected platform the owner chooses what it is used for (text, voice, music, sound effects, images) and which of its models are allowed (`studioAiConnections`). The type pages (**Voice** `/settings/ai/voice`, **Music and sound effects** `/settings/ai/audio`, **Images** `/settings/ai/images`, and **Text and reasoning** `/settings/ai`) all share one layout: a Platforms status list, then "What makes it" with the choices, a Test and a preview, offering only what is connected, switched on and allowed. Changes show at once and save in the background (no page re-render). Images have a primary and a fallback; audio falls back to this Mac when a hosted platform fails. **Settings → Voices** is only the voice library, recording, cloning, design and "Your look".

## Platform vs model

A **platform** holds the key and the bill. A **model** draws the picture. Several platforms run the same model, so the catalog (`lib/studio/images/catalog.ts`) lists each model with every platform that can run it and that platform's own endpoint id.

| Platform | Key | Models it runs here |
|---|---|---|
| fal.ai | the fal.ai key already used for music and sound effects (Settings → AI → Music and sound effects) | FLUX Kontext, FLUX.2, Qwen-Image Edit, Ideogram 3, Stable Diffusion 3.5, SDXL |
| Google AI (Gemini) | the Google AI key in Settings → AI | Gemini image ("Nano Banana") |
| OpenAI | the OpenAI key in Settings → AI | GPT Image (the id is picked from OpenAI's own model list: gpt-image-1 was retired on 23 Oct 2026) |
| Replicate | its own key, entered in Settings → AI → Images | FLUX Kontext, FLUX.2 pro, Qwen-Image Edit, Ideogram 3, Stable Diffusion 3.5, SDXL |
| Black Forest Labs (direct) | its own key | FLUX Kontext, FLUX.2 |
| Ideogram (direct) | its own key | Ideogram 3 |
| Stability AI (direct) | its own key | Stable Diffusion 3.5 |

Midjourney is listed as unavailable: it has no official API, and the "Midjourney APIs" sold by third parties drive a normal account with software, which its terms forbid.

Keys are encrypted Location secrets entered in the product, never read from the environment. Each is checked for free before it is stored (a models list, an account or balance call, or a deliberately empty request that is refused as unauthorised before anything is billed).

## Nothing is trusted blindly

Model ids and prices change quickly. An endpoint is marked **documented** only when its current docs or listing confirmed it; everything else is **unverified** until the Test button has made one real picture with it. The result of each test (works, or the platform's own reason) is saved per platform, model and endpoint and shown beside it. Prices are hints, not promises.

## Prompting (from the owner's research)

One storyboard frame is described once as a `ShotSpec` (`lib/studio/images/prompts.ts`) and rendered in the wording each family answers best:

- **natural** (FLUX.2, GPT Image, Gemini): one flowing description, 30 to 100 words, in the order shot size and angle, subject and action (mid-action, not a static pose), place and time, concrete light, lens and depth of field, realism anchors (skin pores, fabric weave, film grain), palette, continuity.
- **edit** (FLUX Kontext, Qwen-Image Edit): an instruction. Name the person by description, never "she" or "he"; say what must stay the same ("keep the face, hairstyle and clothing exactly the same as in the reference image"); then the new frame and what to match from the previous one.
- **tags** (SDXL, Stable Diffusion 3.5): subject first with a light weight, short phrases, and a real negative prompt.
- **ideogram**: the exact text in quotes first with where it goes, then a simple scene so the lettering has room.

Rules that apply to all: no filler quality words ("masterpiece", "8k", "ultra detailed", "beautiful"): they are removed and the removal is reported; one visual beat per prompt; a locked character block repeated verbatim in every frame; continuity (wardrobe, time of day, light direction) stated, and the previous approved frame passed as a second reference where the model takes more than one; text only for models that render it.

Honest limit: editing models change one picture at a time, so a long sequence can still drift in the face. That is why every frame is reviewed before it is used, and why the next step chains each frame from the creator's photo and the previous approved frame.

## Tests

`lib/studio/images/*.test.ts` cover the catalog, every dialect, each platform's request shape (URL, auth header, fields, references), host allow-lists for returned links, error classification with keys redacted, and the generated test picture. Real generation is untested until keys are entered.

## Your character (Settings → AI → Character)

Storyboard frames show the creator in new scenes, so the same person has to appear in every frame. The Character tab keeps, per person and Location (private, never shown to anyone else), up to **five photos** with a role each (face front-on, face at an angle, full body, an outfit to keep, one more) and a **character card**: aspects (hair, facial hair, glasses, build, skin and age, clothing, accessories, style) each **locked** (repeated in every picture) or **free** (changes per scene, usually clothing), plus free notes. Photos are stored in private storage under keys derived from a hash of the user id; the card is a small manifest beside them. Photo 1 is also the stand-in picture the video flow already used.

Research basis (mostly vendor tutorials, so only practices several repeat): lock identity first and change one thing at a time; describe from the photos and then edit that description; a few good, varied photos beat many for reference-based editing (trained identities need 15 to 20); stage the sheets (turnaround, expressions, outfits) on a plain neutral background with even light; fix drift one panel at a time. Reference-based editing holds a face less reliably than a trained identity over a long series, so each sheet is reviewed.

Built: photo storage, the card editor, and the sheet builder (`lib/studio/images/character-sheet.ts`: card, turnaround, expressions, face and outfit prompts, single views, safe agent edits). The turnaround prompt was verified on the owner's Mac with Codex (five views in one row, one background, same proportions). Sheets are drawn by a Mac job (`studio.character_sheet`, migration `20261203100000_studio_character_sheet`): the page asks the signed-in user's own Mac, which downloads their photos through private links minted at claim time, draws the sheet with the Codex CLI on their ChatGPT login (included in the subscription), uploads the picture through a private upload link, and reports only the file name. Not built yet: choosing which sheet storyboard frames are drawn from, and the agent chat that edits the card and regenerates only what changed.
