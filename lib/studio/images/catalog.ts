/**
 * Image generation for storyboards: which PLATFORM holds your key, which MODEL draws, and how each model wants to be prompted.
 *
 * A platform is where the key lives and the bill goes (fal.ai, Google, OpenAI, Replicate, Black Forest Labs, Ideogram, Stability).
 * A model is what draws the picture (FLUX Kontext, FLUX.2, Gemini image, GPT image, Qwen-Image-Edit, Ideogram, Stable Diffusion).
 * Several platforms host the same model, so a model lists each platform that can run it, with that platform's endpoint.
 *
 * Model ids change quickly (OpenAI retired gpt-image-1 on 23 Oct 2026; Midjourney still has no official API). So nothing here is
 * trusted blindly: an endpoint is "documented" only where its current docs or listing confirmed it, everything else is "unverified"
 * until the Test button has made one real image with it, and OpenAI/Google model ids are discovered from the platform's own model list.
 * Prices are hints from public listings at the time of writing; check the platform's pricing page before budgeting.
 */
export const IMAGE_PLATFORM_IDS = ["fal", "google", "openai", "replicate", "bfl", "ideogram", "stability", "codex"] as const;
export type ImagePlatformId = typeof IMAGE_PLATFORM_IDS[number];

export interface ImagePlatform {
  id: ImagePlatformId;
  label: string;
  /** Where the owner gets a key. */
  keyUrl: string;
  /** The key is shared with another part of the product, so it is entered once there. */
  sharedKey?: string;
  /** Where that shared key is entered (path and label), so the Images page can link to it. */
  sharedKeyHref?: string; sharedKeyLabel?: string;
  /** Plain description of how it is billed. */
  billing: string;
  /** How the key is checked for free before it is stored (or "request" when a deliberately empty request is used). */
  freeCheck: "models-list" | "account" | "balance" | "credits" | "empty-request";
}

export const IMAGE_PLATFORMS: Record<ImagePlatformId, ImagePlatform> = {
  fal: { id: "fal", label: "fal.ai", keyUrl: "https://fal.ai/dashboard/keys", sharedKey: "The same fal.ai key also makes music and sound effects: it is entered once, under Music and sound effects.", sharedKeyHref: "/settings/ai/audio", sharedKeyLabel: "Settings → AI → Music and sound effects", billing: "Pay as you go, per image. One key reaches many models (FLUX, Qwen-Image, Ideogram, Stable Diffusion).", freeCheck: "empty-request" },
  google: { id: "google", label: "Google AI (Gemini)", keyUrl: "https://aistudio.google.com/apikey", sharedKey: "Uses the Google AI key already set for this Location (Text and reasoning).", sharedKeyHref: "/settings/ai", sharedKeyLabel: "Settings → AI → Text and reasoning", billing: "Per image through the Gemini API; roughly $0.04 per image on the 2.5 Flash Image model.", freeCheck: "models-list" },
  openai: { id: "openai", label: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", sharedKey: "Uses the OpenAI key already set for this Location (Text and reasoning).", sharedKeyHref: "/settings/ai", sharedKeyLabel: "Settings → AI → Text and reasoning", billing: "Per image by quality and size; reference-image edits cost extra input tokens.", freeCheck: "models-list" },
  replicate: { id: "replicate", label: "Replicate", keyUrl: "https://replicate.com/account/api-tokens", billing: "Pay as you go, per image. Hosts the same FLUX, Ideogram and Stable Diffusion models as fal.ai.", freeCheck: "account" },
  bfl: { id: "bfl", label: "Black Forest Labs (FLUX, direct)", keyUrl: "https://dashboard.bfl.ai", billing: "Credits (1 credit = $0.01). FLUX.1 Kontext pro is about 4 credits an image; FLUX.2 is billed by megapixel.", freeCheck: "credits" },
  ideogram: { id: "ideogram", label: "Ideogram (direct)", keyUrl: "https://ideogram.ai/manage-api", billing: "Per image by rendering speed. Best for images that contain readable text.", freeCheck: "empty-request" },
  codex: { id: "codex", label: "ChatGPT subscription (Codex on your Mac)", keyUrl: "https://chatgpt.com/", billing: "Included in your ChatGPT subscription: no API key and no pay-as-you-go. Each picture uses about 17,000 to 38,000 tokens of your Codex allowance. Runs on your paired Mac, so the Mac must be on.", freeCheck: "account" },
  stability: { id: "stability", label: "Stability AI (direct)", keyUrl: "https://platform.stability.ai/account/keys", billing: "Credits, per image. Stable Diffusion 3.5 models.", freeCheck: "balance" },
};

/** How the prompt is written. Each model family answers best to a different style (see prompts.ts). */
export type PromptDialect = "natural" | "edit" | "tags" | "ideogram";

export type EndpointStatus = "documented" | "unverified";
export interface ModelEndpoint {
  platform: ImagePlatformId;
  /** The platform's own id for it: a fal endpoint, a Replicate owner/name, a BFL path, a Gemini/OpenAI model id, an Ideogram or Stability path. */
  endpoint: string;
  status: EndpointStatus;
  /** Public price hint per image, when one was found. */
  price?: string;
  /** Where the id comes from the platform's own model list instead of this file (OpenAI, Google). */
  discovered?: boolean;
}

export interface ImageModel {
  id: string;
  label: string;
  /** One line shown to the owner: what it is good at. */
  strength: string;
  dialect: PromptDialect;
  /** How many reference photos (the creator's face, the previous frame) it can take; 0 means text only. */
  references: number;
  /** Whether it takes a negative prompt. */
  negative: boolean;
  /** Whether it renders quoted text well. */
  text: boolean;
  /** Aspect ratios it accepts, as a platform-neutral list. */
  aspects: string[];
  endpoints: ModelEndpoint[];
  /** Short licence or usage note. */
  note?: string;
}

const WIDE = ["16:9", "9:16", "1:1", "4:3", "3:4"];

export const IMAGE_MODELS: ImageModel[] = [
  { id: "codex-imagegen", label: "GPT Image via Codex (ChatGPT subscription)", strength: "Drawn on your own Mac with your ChatGPT login: included in the subscription, keeps the person from your photo across scenes.", dialect: "edit", references: 3, negative: false, text: true, aspects: ["16:9", "9:16", "1:1"],
    endpoints: [{ platform: "codex", endpoint: "imagegen", status: "documented", price: "included in your subscription" }],
    note: "Runs inside Make video on your Mac, one frame per beat that has no footage." },
  { id: "flux-kontext-pro", label: "FLUX.1 Kontext [pro]", strength: "Keeps the same person across scenes from one reference photo; edits by instruction.", dialect: "edit", references: 1, negative: false, text: true, aspects: WIDE,
    endpoints: [
      { platform: "fal", endpoint: "fal-ai/flux-pro/kontext", status: "unverified", price: "about $0.04" },
      { platform: "bfl", endpoint: "flux-kontext-pro", status: "unverified", price: "about 4 credits" },
      { platform: "replicate", endpoint: "black-forest-labs/flux-kontext-pro", status: "unverified" }] },
  { id: "flux-kontext-max", label: "FLUX.1 Kontext [max]", strength: "Highest-fidelity Kontext: better typography and fine detail.", dialect: "edit", references: 1, negative: false, text: true, aspects: WIDE,
    endpoints: [
      { platform: "fal", endpoint: "fal-ai/flux-pro/kontext/max", status: "documented", price: "$0.08" },
      { platform: "bfl", endpoint: "flux-kontext-max", status: "unverified" },
      { platform: "replicate", endpoint: "black-forest-labs/flux-kontext-max", status: "unverified" }] },
  { id: "flux-2-pro", label: "FLUX.2 [pro]", strength: "Strong prompt adherence and multi-reference edits; good default for storyboard frames.", dialect: "natural", references: 8, negative: false, text: true, aspects: WIDE,
    endpoints: [
      { platform: "fal", endpoint: "fal-ai/flux-2-pro/edit", status: "unverified" },
      { platform: "bfl", endpoint: "flux-2-pro", status: "unverified" },
      { platform: "replicate", endpoint: "black-forest-labs/flux-2-pro", status: "unverified" }] },
  { id: "flux-2-max", label: "FLUX.2 [max]", strength: "Top quality FLUX.2, billed by megapixel.", dialect: "natural", references: 8, negative: false, text: true, aspects: WIDE,
    endpoints: [
      { platform: "fal", endpoint: "fal-ai/flux-2-max/edit", status: "documented", price: "$0.07 first megapixel, $0.03 each after" },
      { platform: "bfl", endpoint: "flux-2-max", status: "unverified" }] },
  { id: "gemini-image", label: "Gemini image (Nano Banana)", strength: "No new key if Google AI is set up; takes several reference photos and edits conversationally.", dialect: "natural", references: 3, negative: false, text: true, aspects: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    endpoints: [{ platform: "google", endpoint: "gemini-3.1-flash-image", status: "unverified", price: "about $0.04", discovered: true }] },
  { id: "gpt-image", label: "GPT Image (OpenAI)", strength: "Narrative prompts, strong text and edits with up to 16 reference images.", dialect: "natural", references: 16, negative: false, text: true, aspects: ["16:9", "9:16", "1:1"],
    endpoints: [{ platform: "openai", endpoint: "gpt-image", status: "unverified", discovered: true }],
    note: "gpt-image-1 was retired on 23 Oct 2026: the model is picked from OpenAI's own list for your key." },
  { id: "qwen-image-edit", label: "Qwen-Image Edit", strength: "Cheap, good at instruction edits and text; open weights.", dialect: "edit", references: 3, negative: true, text: true, aspects: WIDE,
    endpoints: [
      { platform: "fal", endpoint: "fal-ai/qwen-image-edit", status: "unverified", price: "about $0.03 to $0.08" },
      { platform: "replicate", endpoint: "qwen/qwen-image-edit", status: "unverified" }] },
  { id: "ideogram-v3", label: "Ideogram 3", strength: "Best for frames that contain readable text (signs, titles, labels); has character reference.", dialect: "ideogram", references: 3, negative: true, text: true, aspects: WIDE,
    endpoints: [
      { platform: "ideogram", endpoint: "ideogram-v3/generate", status: "unverified" },
      { platform: "fal", endpoint: "fal-ai/ideogram/v3", status: "unverified" },
      { platform: "replicate", endpoint: "ideogram-ai/ideogram-v3-turbo", status: "unverified" }] },
  { id: "sd-3-5", label: "Stable Diffusion 3.5 Large", strength: "Open model, short prompts plus a negative prompt; cheap and fast.", dialect: "tags", references: 1, negative: true, text: false, aspects: WIDE,
    endpoints: [
      { platform: "stability", endpoint: "stable-image/generate/sd3", status: "unverified" },
      { platform: "fal", endpoint: "fal-ai/stable-diffusion-v35-large", status: "unverified" },
      { platform: "replicate", endpoint: "stability-ai/stable-diffusion-3.5-large", status: "unverified" }] },
  { id: "sdxl", label: "SDXL", strength: "The classic tag-and-weight prompting with a strong negative prompt; many fine-tunes.", dialect: "tags", references: 0, negative: true, text: false, aspects: WIDE,
    endpoints: [
      { platform: "fal", endpoint: "fal-ai/fast-sdxl", status: "unverified" },
      { platform: "replicate", endpoint: "stability-ai/sdxl", status: "unverified" }] },
];

/** Models that cannot be offered, with the reason shown next to them instead of a key field. */
export const UNSUPPORTED_IMAGE_MODELS = [
  { id: "midjourney", label: "Midjourney", reason: "Midjourney has no official API. The 'Midjourney APIs' for sale drive a normal account with software, which its terms forbid and which risks the account. Use one of the models above." },
] as const;

export const imageModel = (id: string) => IMAGE_MODELS.find(m => m.id === id);
/** Where each model can run, given which platforms have a key. */
export function runnableEndpoints(model: ImageModel, keys: Partial<Record<ImagePlatformId, boolean>>): ModelEndpoint[] {
  return model.endpoints.filter(e => keys[e.platform]);
}
/** The Location's saved choice: one model on one platform. Off until chosen. */
export interface ImageChoice { model: string; platform: ImagePlatformId; /** For discovered ids (OpenAI, Google): the id the owner picked from the platform's list. */ endpoint?: string }
const ID = /^[a-z0-9][a-z0-9._/:-]{1,120}$/i;
export function readImageChoice(value: unknown): ImageChoice | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const model = typeof raw.model === "string" ? imageModel(raw.model) : undefined;
  const platform = (IMAGE_PLATFORM_IDS as readonly unknown[]).includes(raw.platform) ? raw.platform as ImagePlatformId : undefined;
  if (!model || !platform || !model.endpoints.some(e => e.platform === platform)) return null;
  const endpoint = typeof raw.endpoint === "string" && ID.test(raw.endpoint) ? raw.endpoint : undefined;
  return { model: model.id, platform, ...(endpoint ? { endpoint } : {}) };
}
/** The id actually sent: the owner's pick for discovered models, otherwise the catalog's. */
export function endpointFor(choice: ImageChoice): string | null {
  const model = imageModel(choice.model);
  const entry = model?.endpoints.find(e => e.platform === choice.platform);
  if (!model || !entry) return null;
  return entry.discovered ? (choice.endpoint ?? entry.endpoint) : entry.endpoint;
}
