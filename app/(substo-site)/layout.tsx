import "@/app/globals.css";
import { websiteBodyClassName } from "@/lib/website/fonts";
import type { ReactNode } from "react";

/** Public sites never initialize Clerk, create a Contact/User or run Business onboarding. */
export default function PublicSubstoRoot({ children }: { children: ReactNode }) {
  return <html lang="en" suppressHydrationWarning><body className={websiteBodyClassName}>{children}</body></html>;
}
