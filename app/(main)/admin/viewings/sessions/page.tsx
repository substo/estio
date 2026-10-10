import { redirect } from "next/navigation";

export default function LegacyAssistSessionsPage() {
    redirect("/admin/live-assist");
}
