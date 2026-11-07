/**
 * Onboarding topics: the high-level steps of the business onboarding, in order, each with the Business profile fields it
 * fills and a plain question. Client-safe and pure. Values are plain JSON (see FieldValue); lib/onboarding/facts.ts maps
 * them to and from profile facts. Business name and time zone live on Location, not in the profile.
 */
export type FieldKind = "text" | "longtext" | "url" | "email" | "list" | "address" | "phones" | "maps" | "links" | "logos" | "colours"
  | "competitors" | "areas" | "hours" | "countryCode" | "currencyCode" | "timezone";
/** Where a field lives: a dotted Business profile path, or a Location column. */
export type FieldTarget = { profile: string } | { location: "name" | "timeZone" };
export type TopicField = { key: string; label: string; kind: FieldKind; target: FieldTarget; hint?: string; choices?: string[] };
export type TopicId = "business" | "contact" | "online" | "offer" | "market" | "voice" | "look" | "competitors" | "realEstate";
export type Topic = { id: TopicId; title: string; question: string; fields: TopicField[]; apps?: ("estio" | "substo")[] };

const p = (profile: string): FieldTarget => ({ profile });
export const onboardingTopics: Topic[] = [
  { id: "business", title: "Your business", question: "What is your business called, and how would you describe it in a sentence or two?", fields: [
    { key: "stage", label: "Business stage", kind: "text", target: p("setup.stage"), choices: ["starting", "operating"] },
    { key: "kind", label: "Business or personal brand", kind: "text", target: p("setup.kind"), choices: ["business", "personal_brand"] },
    { key: "presence", label: "Where you operate", kind: "text", target: p("setup.presence"), choices: ["online", "physical", "both"] },
    { key: "name", label: "Business name", kind: "text", target: { location: "name" } },
    { key: "summary", label: "Short description", kind: "longtext", target: p("identity.summary") },
    { key: "tagline", label: "Tagline", kind: "text", target: p("identity.tagline") },
  ] },
  { id: "contact", title: "Contact details", question: "Where are you based, and how do customers reach you?", fields: [
    { key: "address", label: "Address", kind: "address", target: p("contact.address") },
    { key: "phones", label: "Phone numbers", kind: "phones", target: p("contact.phones") },
    { key: "email", label: "Email", kind: "email", target: p("contact.email") },
    { key: "openingHours", label: "Opening hours", kind: "hours", target: p("contact.openingHours") },
    { key: "maps", label: "Map link", kind: "maps", target: p("contact.maps") },
    { key: "timeZone", label: "Time zone", kind: "timezone", target: { location: "timeZone" } },
  ] },
  { id: "online", title: "Online presence", question: "What is your website, and which social profiles do you use?", fields: [
    { key: "website", label: "Website", kind: "url", target: p("onlinePresence.website") },
    { key: "profiles", label: "Social profiles", kind: "links", target: p("onlinePresence.profiles") },
  ] },
  { id: "offer", title: "What you offer", question: "What do you sell or do, and what makes you different?", fields: [
    { key: "description", label: "Offer", kind: "longtext", target: p("offer.description") },
    { key: "services", label: "Services", kind: "list", target: p("offer.services") },
    { key: "products", label: "Products", kind: "list", target: p("offer.products") },
    { key: "differentiators", label: "What makes you different", kind: "list", target: p("offer.differentiators") },
  ] },
  { id: "market", title: "Customers and market", question: "Who are your customers, and where do you work?", fields: [
    { key: "audience", label: "Customers", kind: "longtext", target: p("audienceMarket.audience") },
    { key: "serviceAreas", label: "Areas you serve", kind: "areas", target: p("audienceMarket.serviceAreas") },
    { key: "countryCode", label: "Country", kind: "countryCode", target: p("audienceMarket.countryCode"), hint: "Two letters, e.g. CY" },
    { key: "currencyCode", label: "Currency", kind: "currencyCode", target: p("audienceMarket.currencyCode"), hint: "Three letters, e.g. EUR" },
    { key: "languages", label: "Languages", kind: "list", target: p("audienceMarket.supportedLanguages") },
  ] },
  { id: "voice", title: "Brand voice", question: "How should your brand sound? Any words to use or avoid?", fields: [
    { key: "tone", label: "Tone", kind: "text", target: p("brandVoice.tone") },
    { key: "preferredWords", label: "Words to use", kind: "list", target: p("brandVoice.preferredWords") },
    { key: "avoidedWords", label: "Words to avoid", kind: "list", target: p("brandVoice.avoidedWords") },
    { key: "contentPillars", label: "Topics you talk about", kind: "list", target: p("brandVoice.contentPillars") },
  ] },
  { id: "look", title: "Brand look", question: "Do you have a logo and brand colours?", fields: [
    { key: "logos", label: "Logo", kind: "logos", target: p("visualIdentity.logos") },
    { key: "colours", label: "Brand colours", kind: "colours", target: p("visualIdentity.colours") },
  ] },
  { id: "competitors", title: "Competitors", question: "Who do customers compare you with?", fields: [
    { key: "competitors", label: "Competitors", kind: "competitors", target: p("competitors") },
  ] },
  { id: "realEstate", title: "Real estate", apps: ["estio"], question: "What kind of real-estate business are you, and what do you focus on?", fields: [
    { key: "businessTypes", label: "Business type", kind: "list", target: p("realEstate.businessTypes"), hint: "e.g. agency, developer" },
    { key: "services", label: "Services", kind: "list", target: p("realEstate.services"), hint: "e.g. sales, rentals, property management" },
    { key: "propertyCategories", label: "Property types", kind: "list", target: p("realEstate.propertyCategories") },
    { key: "transactionFocus", label: "Focus", kind: "list", target: p("realEstate.transactionFocus"), hint: "e.g. resale, new build, off-plan" },
  ] },
];
export const topicsFor = (app: "estio" | "substo") => onboardingTopics.filter(t => !t.apps || t.apps.includes(app));
export const findTopic = (id: string) => onboardingTopics.find(t => t.id === id);

/** Plain values per kind, as the UI edits them. */
export type FieldValue = string | string[] | { label?: string; number: string }[] | { url: string; title?: string }[] | { platform: string; url: string }[]
  | { variant: string; url: string }[] | { role: string; hex: string }[] | { name: string; website?: string; notes?: string }[]
  | { day: string; closed: boolean; opens?: string; closes?: string }[];
export type FieldStatus = "empty" | "suggested" | "confirmed" | "not_applicable" | "not_yet";
export type TopicStatus = "empty" | "suggested" | "confirmed" | "skipped";
/** A topic is confirmed when something is filled and nothing waits for confirmation; skipped topics stay skipped. */
export function topicStatus(fieldStatuses: FieldStatus[], skipped: boolean): TopicStatus {
  if (fieldStatuses.includes("suggested")) return "suggested";
  if (fieldStatuses.some(s => s === "confirmed" || s === "not_applicable" || s === "not_yet")) return "confirmed";
  return skipped ? "skipped" : "empty";
}
