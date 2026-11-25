# Storyboard images: platforms, models and prompts

Status (2026-11-25): the catalog, prompt builder, platform clients, key storage and the Settings → Voices "Storyboard images" card are built. The storyboard itself (a frame for each beat without footage, drawn from the creator's photo, reviewed before use) is the next step and is not built yet. Nothing is generated until an owner chooses a model and presses Test or Generate.

## Platform vs model

A **platform** holds the key and the bill. A **model** draws the picture. Several platforms run the same model, so the catalog (`lib/studio/images/catalog.ts`) lists each model with every platform that can run it and that platform's own endpoint id.

| Platform | Key | Models it runs here |
|---|---|---|
| fal.ai | the fal.ai key already used for music and sound effects (Settings → Voices) | FLUX Kontext, FLUX.2, Qwen-Image Edit, Ideogram 3, Stable Diffusion 3.5, SDXL |
| Google AI (Gemini) | the Google AI key in Settings → AI | Gemini image ("Nano Banana") |
| OpenAI | the OpenAI key in Settings → AI | GPT Image (the id is picked from OpenAI's own model list: gpt-image-1 was retired on 23 Oct 2026) |
| Replicate | its own key, entered in Settings → Voices | FLUX Kontext, FLUX.2 pro, Qwen-Image Edit, Ideogram 3, Stable Diffusion 3.5, SDXL |
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
