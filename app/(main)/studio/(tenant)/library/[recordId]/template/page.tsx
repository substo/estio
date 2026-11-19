import { redirect } from "next/navigation";
import { studioRouteParams } from "@/lib/studio/route-context";

export const dynamic = "force-dynamic";

/** Script-template extraction now runs from the source page's assistant (Script template mode). */
export default async function StartVideoTemplatePage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await studioRouteParams(params);
  redirect(`/studio/library/${recordId}#script`);
}
