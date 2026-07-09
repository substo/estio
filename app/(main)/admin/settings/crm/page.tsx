import { redirect } from "next/navigation";

export default function CrmSettingsRedirectPage() {
    redirect("/admin/settings/integrations/old-crm");
}
