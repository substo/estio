import { ClerkProvider } from "@clerk/nextjs";
import { Inter } from "next/font/google";
import "@/app/globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
    title: "Securing Connection...",
    description: "SSO Verification",
};

export default function SSOLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <ClerkProvider>
            <html lang="en">
                <body className={inter.className}>
                    <div className="min-h-screen bg-gray-50 flex flex-col justify-center items-center">
                        {children}
                    </div>
                </body>
            </html>
        </ClerkProvider>
    );
}
