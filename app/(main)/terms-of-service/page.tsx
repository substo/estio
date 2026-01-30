import React from "react";
import PageWrapper from "@/components/wrapper/page-wrapper";

export const metadata = {
    title: "Terms of Service | Estio",
    description: "Terms of Service for Estio and associated services.",
};

export default function TermsOfServicePage() {
    return (
        <PageWrapper>
            <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 w-full">
                <div className="max-w-4xl mx-auto bg-white shadow sm:rounded-lg overflow-hidden">
                    <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
                        <h1 className="text-3xl font-bold leading-6 text-gray-900">
                            Terms of Service
                        </h1>
                        <p className="mt-1 max-w-2xl text-sm text-gray-500">
                            Effective Date: December 26, 2025
                        </p>
                    </div>
                    <div className="px-4 py-5 sm:p-6 space-y-8 text-gray-700">
                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                1. Acceptance of Terms
                            </h2>
                            <p className="leading-relaxed">
                                By accessing or using the Estio application ("App"), accessible from{" "}
                                <code className="bg-gray-100 px-1 py-0.5 rounded">
                                    estio.co
                                </code>
                                , you agree to be bound by these Terms of Service ("Terms"). If
                                you disagree with any part of these terms, you may not access the
                                service.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                2. Description of Service
                            </h2>
                            <p className="leading-relaxed">
                                Estio provides a Real Estate Marketplace solution integrated with
                                GoHighLevel (GHL) to facilitate property listings, lead
                                management, and customer relationship management for real estate
                                professionals.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                3. User Accounts and Security
                            </h2>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    <strong>Account Creation:</strong> You may register for an
                                    account using your email or Google Account ("Google Login"). You
                                    agree to provide accurate and complete information.
                                </li>
                                <li>
                                    <strong>Google Auth:</strong> By using Google Login, you acknowledge
                                    that your authentication is handled by Google and Clerk. You are
                                    responsible for maintaining the security of your Google Account.
                                </li>
                                <li>
                                    <strong>Security:</strong> You are responsible for maintaining
                                    the confidentiality of your account credentials and for all
                                    activities that occur under your account. You must notify us
                                    immediately of any unauthorized use.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                4. Google OAuth and Data Usage
                            </h2>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    <strong>Limited Use:</strong> Our use of information received
                                    from Google APIs will adhere to the{" "}
                                    <a
                                        href="https://developers.google.com/terms/api-services-user-data-policy"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:text-blue-800 underline"
                                    >
                                        Google API Services User Data Policy
                                    </a>
                                    , including the Limited Use requirements.
                                </li>
                                <li>
                                    <strong>Permissions:</strong> We request only the necessary
                                    permissions (e.g., email, profile) to provide our services and
                                    authenticate you. We do not sell your personal Google user data.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                5. Third-Party Integrations
                            </h2>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    <strong>GoHighLevel (GHL):</strong> Our App integrates with
                                    GoHighLevel. By using our services, you grant us permission to
                                    share relevant data (such as leads and contact info) with your
                                    GHL account to facilitate CRM functionality.
                                </li>
                                <li>
                                    <strong>Disclaimer:</strong> GoHighLevel is a third-party
                                    service provider. We are not responsible for the availability,
                                    performance, or terms of GoHighLevel. Your use of GHL is subject
                                    to their independent terms and policies.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                6. User Responsibilities
                            </h2>
                            <ul className="list-disc pl-5 space-y-2">
                                <li>
                                    <strong>Real Estate Compliance:</strong> You represent that you
                                    are authorized to list properties and that your content complies
                                    with all applicable real estate laws, fair housing regulations,
                                    and advertising standards in your jurisdiction.
                                </li>
                                <li>
                                    <strong>Prohibited Conduct:</strong> You agree not to use the
                                    App for any illegal purpose, to harass others, or to reverse
                                    engineer our software.
                                </li>
                            </ul>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                7. Intellectual Property
                            </h2>
                            <p className="leading-relaxed">
                                The App and its original content (excluding content provided by
                                you or other users) are and will remain the exclusive property of
                                Estio and its licensors.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                8. Termination
                            </h2>
                            <p className="leading-relaxed">
                                We may terminate or suspend your account immediately, without
                                prior notice or liability, for any reason whatsoever, including
                                without limitation if you breach the Terms.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                9. Limitation of Liability
                            </h2>
                            <p className="leading-relaxed">
                                In no event shall Estio, nor its directors, employees, or partners,
                                be liable for any indirect, incidental, special, consequential or
                                punitive damages, including without limitation, loss of profits,
                                data, use, goodwill, or other intangible losses, resulting from
                                your access to or use of or inability to access or use the
                                Service.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                10. "As Is" and "As Available" Disclaimer
                            </h2>
                            <p className="leading-relaxed">
                                The Service is provided on an "AS IS" and "AS AVAILABLE" basis.
                                The Service is provided without warranties of any kind, whether
                                express or implied.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                11. Governing Law
                            </h2>
                            <p className="leading-relaxed">
                                These Terms shall be governed and construed in accordance with the
                                laws of [Your Jurisdiction], without regard to its conflict of law
                                provisions.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                12. Changes to Terms
                            </h2>
                            <p className="leading-relaxed">
                                We reserve the right, at our sole discretion, to modify or replace
                                these Terms at any time. What constitutes a material change will
                                be determined at our sole discretion.
                            </p>
                        </section>

                        <section>
                            <h2 className="text-xl font-semibold text-gray-900 mb-3">
                                13. Contact Us
                            </h2>
                            <p className="leading-relaxed">
                                If you have any questions about these Terms, please contact us via
                                the support channels within the application.
                            </p>
                        </section>
                    </div>
                </div>
            </div>
        </PageWrapper>
    );
}
