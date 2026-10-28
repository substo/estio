import { saveNavigation } from "@/app/(main)/admin/site-settings/navigation/actions";
import db from "@/lib/db";
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { auth } from '@clerk/nextjs/server';
import { studioRouteParams, withStudioRoute } from '@/lib/studio/route-context';
import { getStudioAccess } from '@/lib/studio/access';
import { studioDb } from '@/lib/studio/studio-db';
import { getPlatformProfile } from '@/lib/platform/profile';
import { studioCommandResponse } from '@/lib/studio/command-http';
import { StudioCommandError } from '@/lib/studio/command-error';
import { brandProfileInputSchema } from '@/lib/brand-profile/schema';
import { saveBrandProfile, getBrandProfile } from '@/lib/brand-profile/service';
import { fetchPublicPage } from '@/lib/web/fetch-public-page';
const commandSchema = z.discriminatedUnion('action', [
    z.object({ action: z.literal('lookup'), url: z.string().url().max(2048) }),
    z.object({ action: z.literal('save'), input: brandProfileInputSchema }),
    z.object({ action: z.literal('enqueue'), requestId: z.string().uuid(), confirmPaid: z.literal(true), input: brandProfileInputSchema,
        excerpts: z.array(z.object({ url: z.string().url(), title: z.string().max(500), text: z.string().max(3000) })).max(3) }),
]);
export const dynamic = 'force-dynamic';
export const POST = withStudioRoute(async (request, { params }) => {
    const { locationId } = await studioRouteParams(params, request);
    return studioCommandResponse(request, { profile: getPlatformProfile,
        parse(value) { const parsed = commandSchema.safeParse(value); if (!parsed.success) throw new StudioCommandError('Check the profile fields and try again.'); return parsed.data; },
        async execute(command) {
            const access = await getStudioAccess(locationId);
            if (!access || access.role !== 'ADMIN' || (await auth()).actor) throw new StudioCommandError('An admin must sign in as themselves.', 403);
            if (command.action === 'lookup') { const page = await fetchPublicPage(command.url); return { page }; }
            if (command.action === 'save') {
                const profile = await saveBrandProfile(locationId, command.input);
                const socials = command.input.sources.filter(source => source.platform).map(source => ({ platform: source.platform!, url: source.url }));
                if (socials.length) {
                    const existing = await db.siteConfig.findUnique({ where: { locationId }, select: { socialLinks: true } });
                    const links = Array.isArray(existing?.socialLinks) ? existing.socialLinks.filter((link): link is { platform: string; url: string } => Boolean(link && typeof link === 'object' && 'url' in link && typeof link.url === 'string' && 'platform' in link && typeof link.platform === 'string')) : [];
                    await saveNavigation(locationId, 'social', [...links.filter(link => !socials.some(source => source.url === link.url)), ...socials]);
                }
                return { profile };
            }
            const snapshot = { answers: command.input.answers, sources: command.input.sources, excerpts: command.excerpts, scriptVersion: 'v1' };
            if (Buffer.byteLength(JSON.stringify(snapshot)) > 24000) throw new StudioCommandError('Shorten the answers or sources.');
            return studioDb.call('studio_enqueue_brand_profile', { p_location_id: locationId, p_actor_app: access.app, p_clerk_user_id: access.userId,
                p_request_id: command.requestId, p_snapshot: snapshot, p_confirm_paid: command.confirmPaid });
        } });
});
export const GET = withStudioRoute(async (request, { params }) => {
    const { locationId } = await studioRouteParams(params, request);
    if (!await getStudioAccess(locationId)) return Response.json({ error: 'Access denied' }, { status: 403 });
    const id = new URL(request.url).searchParams.get('reviewId');
    if (!id) return Response.json({ profile: await getBrandProfile(locationId) }, { headers: { 'Cache-Control': 'private, no-store' } });
    if (!z.string().uuid().safeParse(id).success) return Response.json({ error: 'Invalid review' }, { status: 400 });
    const review = await studioDb.one(Prisma.sql`select r.result,j.status,j.last_error_message from studio.studio_idea_reviews r join studio.studio_jobs j on j.id=r.job_id and j.location_id=r.location_id where r.location_id=${locationId} and r.id=${id}::uuid and r.workflow='brand_profile'`);
    return Response.json({ review }, { headers: { 'Cache-Control': 'private, no-store' } });
});
