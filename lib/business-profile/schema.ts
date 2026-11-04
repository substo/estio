import { z } from 'zod';

const text = z.string().trim().min(1).max(4000);
export const businessUrlSchema = z.string().url().max(2048).refine(value => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
}, 'Use an HTTP or HTTPS URL without credentials');
const timestamp = z.string().datetime({ offset: true });
export const businessSourceSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('url'), url: businessUrlSchema, retrievedAt: timestamp.nullable(), platform: text.optional() }).strict(),
    z.object({ kind: z.literal('owner'), ownerId: text, suppliedAt: timestamp.nullable() }).strict(),
]);
/** Every leaf is a fact. Containers carry no implied provenance or confirmation. */
export function businessFactSchema<T extends z.ZodTypeAny>(value: T) {
    const evidence = { sources: z.array(businessSourceSchema).max(30), confirmedAt: timestamp.nullable() };
    return z.discriminatedUnion('status', [
        z.object({ status: z.literal('known'), value, ...evidence }).strict(),
        z.object({ status: z.literal('unknown'), ...evidence }).strict(),
        z.object({ status: z.literal('not_applicable'), reason: text, ...evidence }).strict(),
    ]);
}
const fact = businessFactSchema;
const stringFact = fact(text);
// Collection wrappers distinguish unknown, no entries, and explicitly not applicable.
const list = <T extends z.ZodTypeAny>(entry: T) => fact(z.array(entry).max(100));
const strings = () => list(stringFact);
const section = <T extends z.ZodRawShape>(shape: T) => z.object(shape).partial().strict();
const address = section({ formatted: stringFact, line1: stringFact, line2: stringFact, city: stringFact, region: stringFact, postalCode: stringFact, countryCode: fact(z.string().regex(/^[A-Z]{2}$/)) });
const phone = section({ label: stringFact, number: fact(z.string().regex(/^\+[1-9]\d{6,14}$/, 'Use E.164 format')), extension: fact(z.string().regex(/^\d{1,10}$/)) });
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const interval = z.object({ opens: fact(time), closes: fact(time), closesNextDay: fact(z.boolean()).optional() }).strict();
const hours = z.object({ day: fact(z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])), closed: fact(z.boolean()), intervals: list(interval) }).strict().superRefine((value, ctx) => {
    if (value.closed.status === 'known' && value.intervals.status === 'known') {
        if (value.closed.value === (value.intervals.value.length > 0)) ctx.addIssue({ code: 'custom', message: 'Closed days have no intervals; open days require intervals' });
        for (const entry of value.intervals.value) {
            if (entry.opens.status === 'known' && entry.closes.status === 'known' && entry.closesNextDay?.status === 'known' && entry.closesNextDay.value) continue;
            if (entry.opens.status === 'known' && entry.closes.status === 'known' && entry.opens.value >= entry.closes.value) ctx.addIssue({ code: 'custom', message: 'Closing time must follow opening time, or set closesNextDay' });
        }
    }
});
const selection = z.object({ code: stringFact, otherDescription: stringFact.optional() }).strict().superRefine((value, ctx) => {
    if (value.code.status === 'known' && value.code.value === 'other' && value.otherDescription?.status !== 'known') ctx.addIssue({ code: 'custom', message: 'Describe other selection' });
});
const priceSegment = section({ label: stringFact, currency: fact(z.string().regex(/^[A-Z]{3}$/)), min: fact(z.number().nonnegative().finite()), max: fact(z.number().nonnegative().finite()) }).superRefine((value, ctx) => {
    if ((value.min?.status === 'known' || value.max?.status === 'known') && value.currency?.status !== 'known') ctx.addIssue({ code: 'custom', message: 'Price bounds require currency' });
    if (value.min?.status === 'known' && value.max?.status === 'known' && value.min.value > value.max.value) ctx.addIssue({ code: 'custom', message: 'Minimum exceeds maximum' });
});
export const businessProfileSchema = z.object({
    schemaVersion: z.literal(1),
    identity: section({ legalName: stringFact, tagline: stringFact, summary: stringFact, registrationNumber: stringFact }).optional(),
    contact: section({ address: fact(address), phones: list(phone), email: fact(z.string().email()), maps: list(section({ url: fact(businessUrlSchema), title: stringFact })), openingHours: list(hours) }).optional(),
    onlinePresence: section({ website: fact(businessUrlSchema), profiles: list(section({ platform: stringFact, url: fact(businessUrlSchema), handle: stringFact })) }).optional(),
    offer: section({ description: stringFact, products: strings(), services: strings(), differentiators: strings(), goals: strings() }).optional(),
    audienceMarket: section({ audience: stringFact, countryCode: fact(z.string().regex(/^[A-Z]{2}$/)), countryName: stringFact, locale: stringFact, currencyCode: fact(z.string().regex(/^[A-Z]{3}$/)), supportedLanguages: strings(), serviceAreas: list(section({ id: stringFact, label: stringFact, aliases: strings(), parentId: stringFact, kind: fact(z.enum(['country', 'region', 'city', 'district', 'locality', 'neighborhood'])) })) }).optional(),
    brandVoice: section({ instructions: stringFact, tone: stringFact, preferredWords: strings(), avoidedWords: strings(), contentPillars: strings() }).optional(),
    visualIdentity: section({ logos: list(section({ variant: fact(z.enum(['primary', 'light', 'icon', 'favicon', 'other'])), url: fact(businessUrlSchema), description: stringFact })), colours: list(section({ role: stringFact, hex: fact(z.string().regex(/^#[0-9a-f]{6}$/i)) })) }).optional(),
    competitors: list(section({ name: stringFact, website: fact(businessUrlSchema), profiles: strings(), notes: stringFact })).optional(),
    realEstate: fact(section({ businessTypes: list(selection), services: list(selection), propertyCategories: list(selection), transactionFocus: list(selection), developmentFocus: list(selection), priceSegments: list(priceSegment), specialisms: list(selection), credentials: strings(), differentiators: strings() })).optional(),
    // Historical capture metadata, never evidence that an owner confirmed a fact.
    brandProfileCapture: z.object({ answers: z.record(stringFact), sources: z.array(businessSourceSchema), scriptVersion: text, updatedAt: timestamp, updatedBy: text }).strict().optional(),
}).strict();
export type BusinessProfile = z.infer<typeof businessProfileSchema>;
