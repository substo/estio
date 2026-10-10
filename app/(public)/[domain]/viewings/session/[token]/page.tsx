import { redirect } from "next/navigation";

export default async function LegacyPublicAssistSessionPage(
    { params }: { params: Promise<{ domain: string; token: string }> }
) {
    const { token } = await params;
    redirect(`/live-assist/join/${encodeURIComponent(token)}`);
}
