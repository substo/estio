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
    <ClerkProvider
      allowedRedirectOrigins={[
        currentDomain,
        'https://estio.co',
      ]}
      // CRITICAL: Ensure we point to the correct Dev Instance even when on estio.co
      // This prevents the "500 Internal Server Error" caused by missing instance context
      domain={CLERK_DEV_FAPI}
      isSatellite={false} // estio.co is the primary (or gateway to FAPI)
    >
      {children}
    </ClerkProvider>
  );
};

export default AuthWrapper;