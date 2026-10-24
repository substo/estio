import { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import config from '@/config';
import { headers } from 'next/headers';
import { getHostBrandConfig, getHostOrigin, resolveHostBrand } from '@/lib/auth/host-brand';
import { getClerkBrandKeys, getClerkSatelliteProps, getSubstoClerkConfigConflicts } from '@/lib/auth/clerk-runtime';
import { BrandExperience } from '@/components/wrapper/brand-experience';

interface AuthWrapperProps {
  children: ReactNode;
}

const AuthWrapper = async ({ children }: AuthWrapperProps) => {
  console.log('[AuthWrapper] Rendering. Config Enabled:', config.auth.enabled);
  const headersList = await headers();
  const host = headersList.get("host") || "";
  const brand = resolveHostBrand(host, getHostBrandConfig());
  if (!config.auth.enabled) {
    return <BrandExperience brand={brand}>{children}</BrandExperience>;
  }
  const currentDomain = getHostOrigin(host);
  if (!currentDomain) throw new Error("The application request host is invalid.");
  const conflicts = brand === "substo" ? getSubstoClerkConfigConflicts() : [];
  if (conflicts.length) throw new Error(`Substo requires removing global Clerk realm settings: ${conflicts.join(", ")}.`);
  const satelliteProps = getClerkSatelliteProps(brand, currentDomain);
  const clerkKeys = brand === "substo" ? getClerkBrandKeys("substo") : null;
  if (brand === "substo" && !clerkKeys) {
    throw new Error("Substo Clerk keys are missing for this allowlisted host.");
  }

  return (
    <ClerkProvider
      {...(clerkKeys ? { publishableKey: clerkKeys.publishableKey } : {})}
      {...satelliteProps}
      allowedRedirectOrigins={[
        currentDomain,
        ...(brand === "substo" ? [] : ['https://estio.co']),
      ]}
      signInUrl={brand === "substo" ? "/sign-in" : process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
      signUpUrl={brand === "substo" ? "/sign-up" : process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
      signInFallbackRedirectUrl={brand === "substo" ? "/studio" : "/"}
      signUpFallbackRedirectUrl={brand === "substo" ? "/studio" : "/"}
      dynamic
    >
      <BrandExperience brand={brand}>{children}</BrandExperience>
    </ClerkProvider>
  );
};

export default AuthWrapper;
