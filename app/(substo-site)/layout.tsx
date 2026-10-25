import "@/app/globals.css";
import { GeistSans } from "geist/font/sans";
import type { ReactNode } from "react";

/** Public sites never initialize Clerk, create a Contact/User or run Business onboarding. */
export default function PublicSubstoRoot({ children }: { children: ReactNode }) {
  return <html lang="en"><body className={`${GeistSans.className} bg-white text-slate-900`}>{children}</body></html>;
}
