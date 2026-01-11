import { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';
import config from '@/config';
import { headers } from 'next/headers';

interface AuthWrapperProps {
  children: ReactNode;
}

const AuthWrapper = async ({ children }: AuthWrapperProps) => {
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
    >
      {children}
    </ClerkProvider>
  );
};

export default AuthWrapper;