import { redirect } from "next/navigation";

export default async function LegacyAssistSessionPage(
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    redirect(`/admin/live-assist/sessions/${encodeURIComponent(id)}`);
}
