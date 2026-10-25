import { getRequestAuthRealm } from "@/lib/auth/request-realm";
import type { ReactNode } from "react";

export default function StudioLayout({ children }: { children: ReactNode }) { return children; }
export async function generateMetadata() { return await getRequestAuthRealm() === "substo" ? { title: "Studio" } : {}; }
