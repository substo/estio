import type { AuthRealm } from "@/lib/auth/auth-realm";

/** Product identity, distinct from the customer's brand (Prisma Location). */
export const APP_IDENTITIES = {
  estio: { name: "Estio", description: "The AI Engine for Real Estate Automation.", icon: "/images/estio favicon/android-chrome-192x192.png" },
  substo: { name: "Substo", description: "Manage your brand, relationships and content with CRM and Studio.", icon: "/images/substo-mark.svg" },
} as const;

export function appIdentity(app: AuthRealm) { return APP_IDENTITIES[app]; }
