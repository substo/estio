import React from "react";
import PageWrapper from "@/components/wrapper/page-wrapper";

export const metadata = {
    title: "Privacy Policy | Estio",
    description: "Privacy Policy for Estio and associated services.",
};

export default function PrivacyPolicyPage() {
    return (
        <PageWrapper>
            <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 w-full">
                <div className="max-w-4xl mx-auto bg-white shadow sm:rounded-lg overflow-hidden">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                        <h1 className="text-3xl font-bold leading-6 text-gray-900">
                            Privacy Policy
                        </h1>
                        <p className="mt-1 max-w-2xl text-sm text-gray-500">
                            Effective Date: December 26, 2025
                        </p>
                    </div>
                    <div className="px-4 py-5 sm:p-6 space-y-8 text-gray-700">
                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                1. Introduction
                            </h2>
                            <p className="leading-relaxed">
                                Welcome to Estio (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;). This Privacy Policy
                                explains how we collect, use, disclose, and safeguard your
                                information when you visit our application, accessible from{" "}
                                <code className="bg-gray-100 px-1 py-0.5 rounded">
                                    estio.co
                                </code>
                                . Please read this privacy policy carefully.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                2. Information We Collect
                            </h2>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    <strong>Personal Data:</strong> When you register using Google
                                    Login, we receive your email address, name, and profile picture
                                    from Google.
                                </li>
                                <li>
                                    <strong>Usage Data:</strong> We may collect information about
                                    how you access and use the application, including your IP
                                    address, browser type, and pages visited.
                                </li>
                                <li>
                                    <strong>Property Data:</strong> If you are a real estate agent,
                                    we collect property listing information you provide.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                3. How We Use Your Information
                            </h2>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>To provide and maintain our service</li>
                                <li>To authenticate your identity via Google Login</li>
                                <li>To communicate with you about your account</li>
                                <li>To sync data with GoHighLevel CRM on your behalf</li>
                                <li>To improve our services</li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                4. Google User Data
                            </h2>
                            <p className="leading-relaxed mb-3">
                                Our use of information received from Google APIs adheres to the{" "}
                                <a
                                    href="https://developers.google.com/terms/api-services-user-data-policy"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:text-blue-800 underline"
                                >
                                    Google API Services User Data Policy
                                </a>
                                , including the Limited Use requirements. Specifically:
                            </p>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    We only request access to your Google account information
                                    (email, name, profile picture) for authentication purposes.
                                </li>
                                <li>
                                    We do not use Google user data for advertising or to serve ads.
                                </li>
                                <li>
                                    We do not sell your Google user data to third parties.
                                </li>
                                <li>
                                    We do not use Google user data to determine creditworthiness or
                                    for lending purposes.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                5. Third-Party Services
                            </h2>
                            <p className="leading-relaxed mb-3">
                                We share your data with the following third-party services:
                            </p>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    <strong>Clerk:</strong> For authentication and user management.
                                </li>
                                <li>
                                    <strong>GoHighLevel (GHL):</strong> For CRM integration and lead
                                    management.
                                </li>
                                <li>
                                    <strong>Cloudflare:</strong> For media hosting and CDN services.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                6. Data Security
                            </h2>
                            <p className="leading-relaxed">
                                We use administrative, technical, and physical security measures
                                to protect your personal information. However, no electronic
                                transmission or storage of information can be guaranteed to be
                                100% secure.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                7. Data Retention
                            </h2>
                            <p className="leading-relaxed">
                                We will retain your information for as long as your account is
                                active or as needed to provide you services. You may request
                                deletion of your account and associated data at any time.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                8. Your Rights
                            </h2>
                            <p className="leading-relaxed">
                                Depending on your location, you may have rights regarding your
                                personal data, including the right to access, correct, or delete
                                your information. To exercise these rights, please contact us.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                9. Changes to This Policy
                            </h2>
                            <p className="leading-relaxed">
                                We may update this Privacy Policy from time to time. We will
                                notify you of any changes by posting the new Privacy Policy on
                                this page and updating the &quot;Effective Date&quot; above.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                10. Contact Us
                            </h2>
                            <p className="leading-relaxed">
                                If you have any questions about this Privacy Policy, please
                                contact us via the support channels within the application.
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </PageWrapper>
    );
}
