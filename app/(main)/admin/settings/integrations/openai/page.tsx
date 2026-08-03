import { redirect } from "next/navigation";

export default function LegacyOpenAiIntegrationPage() {
    redirect("/admin/settings/integrations/chatgpt-subscription");
}
