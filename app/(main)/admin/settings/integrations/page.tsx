import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
    Activity,
    Blocks,
    Bot,
    DatabaseZap,
    Mail,
    MessageSquare,
    Smartphone,
    Users,
} from "lucide-react";

type IntegrationSection = {
    title: string;
    description: string;
    href: string;
    cta: string;
    icon: LucideIcon;
    iconClassName: string;
};

type IntegrationGroup = {
    title: string;
    description: string;
    sections: IntegrationSection[];
};

const INTEGRATION_GROUPS: IntegrationGroup[] = [
    {
        title: "CRM and property data",
        description: "Systems that provide listing, lead, and provider data.",
        sections: [
            {
                title: "Old CRM",
                description: "Connect legacy CRM credentials, imported listing links, lead email detection, and schema tools.",
                href: "/admin/settings/integrations/old-crm",
                cta: "Configure Old CRM",
                icon: DatabaseZap,
                iconClassName: "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
            },
            {
                title: "GoHighLevel",
                description: "Manage the connection to your GoHighLevel location, specific tokens, and syncing preferences.",
                href: "/admin/settings/integrations/ghl",
                cta: "Configure Integration",
                icon: Blocks,
                iconClassName: "bg-violet-100 text-violet-700 dark:bg-violet-900/20 dark:text-violet-300",
            },
            {
                title: "Provider Sync Operations",
                description: "Monitor async provider queues, retry failed mirror jobs, and inspect sync alias health.",
                href: "/admin/settings/integrations/provider-sync",
                cta: "Open Operations",
                icon: Activity,
                iconClassName: "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400",
            },
        ],
    },
    {
        title: "Messaging and workspace",
        description: "Channels used for customer conversations, email, contacts, and SMS.",
        sections: [
            {
                title: "WhatsApp",
                description: "Connect the WhatsApp account used on your phone by scanning a QR code.",
                href: "/admin/settings/integrations/whatsapp",
                cta: "Connect WhatsApp",
                icon: MessageSquare,
                iconClassName: "bg-green-100 text-green-600 dark:bg-green-900/20 dark:text-green-400",
            },
            {
                title: "Google Workspace",
                description: "Sync Contacts and Gmail (Two-Way) to manage leads and communication.",
                href: "/admin/settings/integrations/google",
                cta: "Configure Integration",
                icon: Users,
                iconClassName: "bg-blue-100 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
            },
            {
                title: "Microsoft Outlook",
                description: "Sync Emails and Contacts with Outlook (Personal or Office 365).",
                href: "/admin/settings/integrations/microsoft",
                cta: "Configure Integration",
                icon: Mail,
                iconClassName: "bg-sky-100 text-sky-600 dark:bg-sky-900/20 dark:text-sky-400",
            },
            {
                title: "Connected Devices",
                description: "Manage physical devices used for SMS Relay and STO Secure Delivery.",
                href: "/admin/settings/integrations/sms-relay",
                cta: "Manage Devices",
                icon: Smartphone,
                iconClassName: "bg-rose-100 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300",
            },
        ],
    },
    {
        title: "AI services",
        description: "Model providers and AI account connections.",
        sections: [
            {
                title: "OpenAI",
                description: "Connect ChatGPT subscription access and OpenAI API keys. Default model selection lives in AI Configuration.",
                href: "/admin/settings/integrations/openai",
                cta: "Configure OpenAI",
                icon: Bot,
                iconClassName: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
            },
        ],
    },
];

function IntegrationCard({ section }: { section: IntegrationSection }) {
    const Icon = section.icon;

    return (
        <Link href={section.href} prefetch={false} className="group block h-full">
            <div className="flex h-full flex-col justify-between rounded-lg border p-6 transition-colors hover:border-primary hover:bg-muted/50">
                <div className="space-y-4">
                    <div className="flex items-center space-x-3">
                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${section.iconClassName}`}>
                            <Icon className="h-6 w-6" />
                        </div>
                        <h3 className="font-semibold text-lg">{section.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground">{section.description}</p>
                </div>
                <div className="mt-6 flex items-center text-sm font-medium text-primary group-hover:underline">
                    {section.cta} &rarr;
                </div>
            </div>
        </Link>
    );
}

export default function IntegrationsPage() {
    return (
        <div className="space-y-8">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
                <p className="text-muted-foreground">Manage external systems by workflow area.</p>
            </div>

            {INTEGRATION_GROUPS.map((group) => (
                <section key={group.title} className="space-y-3">
                    <div>
                        <h2 className="text-base font-semibold">{group.title}</h2>
                        <p className="text-sm text-muted-foreground">{group.description}</p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {group.sections.map((section) => (
                            <IntegrationCard key={section.href} section={section} />
                        ))}
                    </div>
                </section>
            ))}
        </div>
    );
}
