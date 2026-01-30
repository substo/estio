import Link from "next/link";
import { APP_NAME } from "../app-logo";

export function AboutSection() {
    return (
        <section className="py-24 border-t w-full">
            <div className="container px-4 md:px-6 mx-auto max-w-4xl text-center">
                <h2 className="text-3xl font-bold tracking-tighter sm:text-4xl mb-6">
                    About {APP_NAME}
                </h2>
                <p className="text-lg text-muted-foreground mb-8 leading-relaxed">
                    {APP_NAME} is the premier compliance and integration middleware designed specifically for real estate professionals using <strong>GoHighLevel</strong>.
                    <br /><br />
                    Our mission is to bridge the gap between complex Property Data Feeds (MLS, XML) and modern marketing automation.
                    We enable agencies to publish high-performance property websites, capture leads directly into their CRM, and automate follow-up sequences without manual data entry.
                </p>

                <div className="flex flex-col sm:flex-row justify-center items-center gap-6 text-sm text-muted-foreground mt-12 pt-8 border-t">
                    <span>&copy; {new Date().getFullYear()} {APP_NAME}. All rights reserved.</span>
                    <nav className="flex gap-6">
                        <Link href="/privacy-policy" className="hover:text-primary hover:underline underline-offset-4 font-medium transition-colors">
                            Privacy Policy
                        </Link>
                        <Link href="/terms-of-service" className="hover:text-primary hover:underline underline-offset-4 font-medium transition-colors">
                            Terms of Service
                        </Link>
                    </nav>
                </div>
            </div>
        </section>
    );
}
