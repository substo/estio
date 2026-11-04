import { notFound } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";
import BuildWorkspace from "./workspace";
export const dynamic = "force-dynamic";
export default async function BuildPage() {
  if (!await getPlatformAdminContext()) notFound();
  return <BuildWorkspace />;
}
