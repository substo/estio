import { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import config from '@/config';
import { headers } from 'next/headers';
import { CLERK_DEV_FAPI } from '@/lib/auth/clerk-config';

interface AuthWrapperProps {
  children: ReactNode;
}

const AuthWrapper = async ({ children }: AuthWrapperProps) => {
  console.log('[AuthWrapper] Rendering. Config Enabled:', config.auth.enabled);
  if (!config.auth.enabled) {
    return <>{children}</>;
  }

  const headersList = await headers();
  const host = headersList.get("host") || "";
  const protocols = host.includes("localhost") ? "http" : "https";
  const currentDomain = `${protocols}://${host}`;

  return (
    // @ts-ignore - ClerkProvider types are strict about router props but Next.js handles this
    <ClerkProvider
      allowedRedirectOrigins={[
        currentDomain,
        'https://estio.co',
      ]}
      // CRITICAL: Ensure we point to the correct Dev Instance even when on estio.co
      // This prevents the "500 Internal Server Error" caused by missing instance context
      // domain={CLERK_DEV_FAPI}
      // Satellite mode is for TENANT domains only (e.g., downtowncyprus.site)
      // estio.co is the PRIMARY platform domain - it should NOT be a satellite
      // This prevents the redirect loop on the main site
      isSatellite={!currentDomain.includes("localhost") && !currentDomain.includes("estio.co")}
      // Required for dev keys in production: explicit sign-in URL
      signInUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in"}
      signUpUrl={process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up"}
      // When using dev keys in production, we need to specify the sign-in fallback redirect
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      dynamic
    >
      {children}
    </ClerkProvider>
  );
};

export default AuthWrapper;