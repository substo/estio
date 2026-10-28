import { auth } from "@clerk/nextjs/server";
import { studioDb } from "@/lib/studio/studio-db";
import { Prisma } from "@prisma/client";
import { brandProfileInputSchema } from "@/lib/brand-profile/schema";
import { getProfileYoutubeSummary } from "@/lib/google/profile-youtube";
import { notFound } from 'next/navigation';
import { studioRouteParams } from '@/lib/studio/route-context';
import { getStudioAccess } from '@/lib/studio/access';
import { getBrandProfile } from '@/lib/brand-profile/service';
import { getStudioAiSettings } from '@/lib/studio/ai-settings';
import { BrandOnboarding } from './profile-editor';
export const dynamic = 'force-dynamic';
export default async function OnboardingPage({ params }: { params: Promise<{}> }) {
    const { locationId } = await studioRouteParams(params);
    const access = await getStudioAccess(locationId); if (!access) notFound();
    const [profile, ai, youtube] = await Promise.all([getBrandProfile(locationId), getStudioAiSettings(locationId), getProfileYoutubeSummary()]);
    const latest = access.role === 'ADMIN' ? await studioDb.one<{ id: string; request_id: string; snapshot: any; result: any; created_at: string; status: string }>(Prisma.sql`
        select r.id,r.request_id,r.snapshot,r.result,r.created_at,j.status from studio.studio_idea_reviews r
        join studio.studio_jobs j on j.id=r.job_id and j.location_id=r.location_id
        where r.location_id=${locationId} and r.workflow='brand_profile' and r.created_by_clerk_user_id=${access.userId}
        order by r.created_at desc limit 1`) : null;
    const resume = latest && (!profile || new Date(latest.created_at)>new Date(profile.updatedAt)) ? latest : null;
    const resumed = resume ? brandProfileInputSchema.safeParse({ answers: resume.snapshot.answers, sources: resume.snapshot.sources || [], scriptVersion:'v1', profile: resume.result || {summary:'',audience:'',offer:'',tone:'',useWords:[],avoidWords:[],pillars:[]} }) : null;
    return <main className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-8"><h1 className="text-2xl font-semibold">Brand profile</h1>
        <BrandOnboarding locationId={locationId} initial={resumed?.success ? resumed.data : profile} resume={resume ? { reviewId:resume.result ? null : resume.id, requestId:resume.request_id, excerpts:resume.snapshot.excerpts || [] } : null} canManage={access.role === 'ADMIN' && !(await auth()).actor}
            youtubeConnected={Boolean(youtube?.connectedAt)} paidReady={Boolean(ai?.openai && ai.monthlyBudgetMicros-ai.spentMicros-ai.heldMicros >= 10000)}
            remainingMicros={ai ? ai.monthlyBudgetMicros-ai.spentMicros-ai.heldMicros : 0} />
    </main>;
}
