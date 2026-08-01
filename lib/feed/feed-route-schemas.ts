import { z } from 'zod';

export const companyIdSchema = z.string().trim().min(1).max(128);
export const feedUrlSchema = z.string()
    .trim()
    .min(1)
    .max(2_048)
    .transform((value, context) => {
        let url: URL;
        try {
            url = new URL(value);
        } catch {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A valid feed URL is required.',
            });
            return z.NEVER;
        }
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'A standard HTTP or HTTPS feed URL is required.',
            });
            return z.NEVER;
        }
        url.hash = '';
        return url.href;
    });
const mappingPathSchema = z.union([
    z.string().trim().max(500),
    z.null(),
]).transform((value) => value || '');

export const feedMappingConfigSchema = z.object({
    rootPath: mappingPathSchema.optional(),
    fields: z.object({
        externalId: mappingPathSchema,
        title: mappingPathSchema,
        description: mappingPathSchema,
        price: mappingPathSchema,
        currency: mappingPathSchema,
        images: mappingPathSchema,
        city: mappingPathSchema.optional(),
        country: mappingPathSchema.optional(),
        addressLine1: mappingPathSchema.optional(),
        bedrooms: mappingPathSchema.optional(),
        bathrooms: mappingPathSchema.optional(),
        areaSqm: mappingPathSchema.optional(),
    }),
});

export const analyzeFeedRequestSchema = z.object({
    url: feedUrlSchema,
    companyId: companyIdSchema,
});

export const previewFeedRequestSchema = analyzeFeedRequestSchema.extend({
    mappingConfig: feedMappingConfigSchema,
});
