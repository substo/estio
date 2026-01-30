import { GeistSans } from 'geist/font/sans'
import '@/app/globals.css'
import type { Metadata } from 'next'
import { ThemeProvider } from "@/components/theme-provider"

export const metadata: Metadata = {
    title: 'Estio Support',
    description: 'Get help with Estio - The AI Real Estate Engine.',
}

export default function PublicLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <html lang="en" suppressHydrationWarning>
            <body className={GeistSans.className}>
                <ThemeProvider
                    attribute="class"
                    defaultTheme="system"
                    enableSystem
                    disableTransitionOnChange
                >
                    {children}
                </ThemeProvider>
            </body>
        </html>
    )
}
