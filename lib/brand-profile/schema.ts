import { z } from 'zod';
const text = z.string().trim().max(4000);
export const brandProfileSchema = z.object({
    answers: z.record(z.string().max(80), text).refine(value => Object.keys(value).length <= 40, "Too many answers"),
    sources: z.array(z.object({ url: z.string().url().max(2048).refine(value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } }, 'Use a public HTTP or HTTPS URL'), fetchedAt: z.string().datetime(), platform: z.string().trim().min(1).max(80).optional() })).max(10),
    profile: z.object({ summary: text, audience: text, offer: text, tone: text,
        useWords: z.array(z.string().trim().max(100)).max(30),
        avoidWords: z.array(z.string().trim().max(100)).max(30),
        pillars: z.array(z.string().trim().max(300)).max(12) }),
    scriptVersion: z.literal('v1'),
    updatedAt: z.string().datetime(),
    updatedBy: z.string().min(1).max(255),
});
export const brandProfileInputSchema = brandProfileSchema.omit({ updatedAt: true, updatedBy: true });
export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;
export function renderBrandVoice(profile: BrandProfileInput['profile']) {
    return [`Summary: ${profile.summary}`, `Audience: ${profile.audience}`, `Offer: ${profile.offer}`,
        `Tone: ${profile.tone}`, `Use: ${profile.useWords.join(', ')}`, `Avoid: ${profile.avoidWords.join(', ')}`,
        `Content pillars: ${profile.pillars.join('; ')}`].join('\n');
}
