import Provider from '@/app/(main)/provider'
import { ThemeProvider } from "@/components/theme-provider"
import { Toaster } from "@/components/ui/sonner"
import AuthWrapper from '@/components/wrapper/auth-wrapper'
import { GeistSans } from 'geist/font/sans'
import type { Metadata } from 'next'
import '@/app/globals.css'
import { APP_URL } from '@/lib/app-config';

console.log('[MainLayout] Rendering');

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: 'Estio',
    template: `%s | Estio`
  },
  description: 'Estio - The AI Engine for Real Estate Automation. Auto-import listings, generate sites, and sync with GoHighLevel.',
  openGraph: {
    description: 'Estio - The AI Engine for Real Estate Automation. Auto-import listings, generate sites, and sync with GoHighLevel.',
    images: ['https://utfs.io/f/8a428f85-ae83-4ca7-9237-6f8b65411293-eun6ii.png'],
    url: APP_URL
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Estio',
    description: 'Estio - The AI Engine for Real Estate Automation. Auto-import listings, generate sites, and sync with GoHighLevel.',
    siteId: "",
    creator: "@estio_ai",
    creatorId: "",
    images: ['https://utfs.io/f/8a428f85-ae83-4ca7-9237-6f8b65411293-eun6ii.png'],
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="preload"
          href="https://utfs.io/f/31dba2ff-6c3b-4927-99cd-b928eaa54d5f-5w20ij.png"
          as="image"
        />
        <link
          rel="preload"
          href="https://utfs.io/f/69a12ab1-4d57-4913-90f9-38c6aca6c373-1txg2.png"
          as="image"
        />
      </head>
      <body className={GeistSans.className}>
        <AuthWrapper>
          <Provider>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              {children}
              <Toaster />
            </ThemeProvider>
          </Provider>
        </AuthWrapper>
      </body>
    </html>
  )
}
