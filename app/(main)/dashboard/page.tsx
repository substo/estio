import { redirect } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";

export default async function DashboardEntryPage() {
  redirect((await getPlatformAdminContext()) ? "/platform" : "/admin");
}
