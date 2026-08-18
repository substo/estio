import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getPlatformAdminContext } from "@/lib/auth/platform-access";

export default async function AdminPlatformLayout({ children }: { children: ReactNode }) {
  if (!(await getPlatformAdminContext())) notFound();
  return children;
}
