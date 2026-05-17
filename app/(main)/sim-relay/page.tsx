import Link from "next/link";
import type { Metadata } from "next";
import {
    AlertTriangle,
    BadgeCheck,
    CheckCircle2,
    Clock3,
    Download,
    KeyRound,
    MessageSquareText,
    Phone,
    Radio,
    ShieldCheck,
    Smartphone,
    WifiOff,
    Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import PageWrapper from "@/components/wrapper/page-wrapper";

export const metadata: Metadata = {
    title: "SIM Relay | Estio",
    description:
        "Send and receive CRM SMS through your own Android SIM card instead of paying per-message gateway fees.",
};

const setupSteps = [
    {
        title: "Install Estio in GoHighLevel",
        text: "Go to the agency installation page, add the Estio custom menu link, and sign in.",
    },
    {
        title: "Open SIM Relay settings",
        text: "In Estio, go to Settings > Integrations > SIM Relay.",
    },
    {
        title: "Download the Android app",
        text: "Download the Estio SIM Relay APK from the logged-in setup screen.",
    },
    {
        title: "Prepare the phone",
        text: "Use a physical Android phone with an active SIM, SMS allowance, mobile signal, and internet connection.",
    },
    {
        title: "Pair the device",
        text: "Click Pair Device, then scan the QR code or enter the pairing code in the Android app.",
    },
    {
        title: "Grant permissions",
        text: "Allow SMS send and receive permissions, and keep the foreground service running.",
    },
    {
        title: "Turn on SIM Relay",
        text: "Enable SIM Relay for the location once the phone is connected.",
    },
    {
        title: "Send a test message",
        text: "Open a Conversation, choose Android SMS, send a test, and confirm the reply appears in Estio.",
    },
];

const valueCards = [
    {
        title: "Cut gateway costs",
        text: "Your carrier or SIM plan handles SMS instead of routing every message through a usage-priced gateway.",
        icon: Zap,
    },
    {
        title: "Keep a local number",
        text: "Replies come from the real phone number customers already recognize.",
        icon: Phone,
    },
    {
        title: "Works inside Conversations",
        text: "Agents choose Android SMS, send replies, and see inbound texts in the Estio thread.",
        icon: MessageSquareText,
    },
    {
        title: "Built for reliability",
        text: "An outbox queue, delivery result updates, and device status help reduce lost-message risk.",
        icon: ShieldCheck,
    },
    {
        title: "Know the real SMS count",
        text: "Long messages, emojis, and smart punctuation can turn one draft into multiple billable SMS parts. Estio shows the count before your team sends.",
        icon: BadgeCheck,
    },
];

const trustItems = [
    {
        title: "Expiring pairing codes",
        text: "Each phone is linked with a short-lived QR or manual code.",
        icon: Clock3,
    },
    {
        title: "Device tokens after pairing",
        text: "The Android app receives its device token only after the pairing flow succeeds.",
        icon: KeyRound,
    },
    {
        title: "Webhook verification",
        text: "Inbound SMS webhooks can be verified with the configured relay secret.",
        icon: BadgeCheck,
    },
    {
        title: "Offline-safe queueing",
        text: "If the phone is offline, messages remain pending instead of disappearing.",
        icon: WifiOff,
    },
];

const faqs = [
    {
        question: "Does SIM Relay replace Twilio?",
        answer:
            "Yes for supported SMS workflows inside Estio when you want to send through your own Android SIM instead of a gateway number.",
    },
    {
        question: "Can I use an iPhone?",
        answer: "No. SIM Relay uses the Estio Android relay app and requires an Android phone.",
    },
    {
        question: "Can I use an emulator?",
        answer:
            "No. The relay needs a physical device with a real SIM because emulators cannot send physical carrier SMS.",
    },
    {
        question: "What happens if the phone is offline?",
        answer:
            "Estio keeps outbound messages queued or pending and shows the device connection status in the integration screen.",
    },
    {
        question: "Can I use multiple phones?",
        answer:
            "SIM Relay includes paired-device management. Availability and routing should be checked from the logged-in setup screen for your account.",
    },
    {
        question: "Is it good for high-volume bulk marketing?",
        answer:
            "It is best for local operational follow-up and steady agency messaging, not unmanaged blasting. Consent, opt-out, carrier rules, and local SMS regulations still apply.",
    },
    {
        question: "Why does Estio show SMS parts?",
        answer:
            "SMS carriers often charge per part, especially for long texts or messages with emojis and special characters. Estio shows the estimate before sending so teams can control cost without learning SMS technical rules.",
    },
];

export default function SimRelayPage() {
    return (
        <PageWrapper>
            <div className="w-full">
                <section className="border-b bg-background">
                    <div className="container mx-auto grid min-h-[calc(100vh-10rem)] max-w-6xl items-center gap-10 px-4 py-16 md:grid-cols-[1.05fr_0.95fr] md:py-20">
                        <div className="space-y-7">
                            <div className="inline-flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-1 text-sm font-medium text-muted-foreground">
                                <Smartphone className="h-4 w-4 text-blue-600" />
                                Android SMS gateway for Estio
                            </div>
                            <div className="space-y-4">
                                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
                                    SIM Relay
                                </h1>
                                <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                                    Use a real Android phone and SIM card as your Estio SMS channel.
                                    Send and receive texts from your CRM while avoiding per-message SMS
                                    gateway markups.
                                </p>
                            </div>
                            <div className="flex flex-col gap-3 sm:flex-row">
                                <Button asChild size="lg" className="bg-blue-600 text-white hover:bg-blue-500">
                                    <Link href="/admin/settings/integrations/sms-relay">
                                        Set up SIM Relay
                                    </Link>
                                </Button>
                                <Button asChild size="lg" variant="outline">
                                    <Link href="/setup">Install Estio</Link>
                                </Button>
                            </div>
                        </div>

                        <div className="rounded-lg border bg-slate-950 p-5 text-white shadow-xl dark:border-slate-800">
                            <div className="mb-5 flex items-center justify-between border-b border-white/10 pb-4">
                                <div>
                                    <p className="text-sm text-slate-300">Relay phone</p>
                                    <p className="font-semibold">Limassol Office Android</p>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-md bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-200">
                                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                    Connected
                                </span>
                            </div>
                            <div className="space-y-3">
                                <div className="rounded-md bg-white/10 p-4">
                                    <p className="text-xs uppercase text-slate-400">Outbound channel</p>
                                    <div className="mt-3 flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <Radio className="h-5 w-5 text-blue-300" />
                                            <span className="font-medium">Android SMS</span>
                                        </div>
                                        <CheckCircle2 className="h-5 w-5 text-emerald-300" />
                                    </div>
                                </div>
                                <div className="rounded-md bg-white/10 p-4">
                                    <p className="text-xs uppercase text-slate-400">Queued message</p>
                                    <p className="mt-2 text-sm text-slate-100">
                                        Thanks for your enquiry. I can show you the apartment tomorrow at 11:30.
                                    </p>
                                </div>
                                <div className="grid grid-cols-3 gap-3 text-center text-sm">
                                    <div className="rounded-md bg-white/10 p-3">
                                        <p className="text-2xl font-semibold">0</p>
                                        <p className="text-slate-400">Pending</p>
                                    </div>
                                    <div className="rounded-md bg-white/10 p-3">
                                        <p className="text-2xl font-semibold">98%</p>
                                        <p className="text-slate-400">Online</p>
                                    </div>
                                    <div className="rounded-md bg-white/10 p-3">
                                        <p className="text-2xl font-semibold">Local</p>
                                        <p className="text-slate-400">SIM line</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="bg-slate-50 py-16 dark:bg-slate-900/40">
                    <div className="container mx-auto max-w-6xl px-4">
                        <div className="mb-8 max-w-3xl">
                            <h2 className="text-3xl font-semibold tracking-tight">Why agencies use SIM Relay</h2>
                            <p className="mt-3 text-muted-foreground">
                                Keep SMS inside Estio while letting your carrier plan do what it already does well:
                                send and receive local text messages.
                            </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                            {valueCards.map((item) => (
                                <Card key={item.title} className="rounded-lg">
                                    <CardHeader>
                                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-blue-600/10 text-blue-600">
                                            <item.icon className="h-5 w-5" />
                                        </div>
                                        <CardTitle className="text-lg">{item.title}</CardTitle>
                                    </CardHeader>
                                    <CardContent>
                                        <p className="text-sm leading-6 text-muted-foreground">{item.text}</p>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="border-y py-16">
                    <div className="container mx-auto grid max-w-6xl gap-8 px-4 lg:grid-cols-[0.95fr_1.05fr]">
                        <div>
                            <h2 className="text-3xl font-semibold tracking-tight">A practical alternative to gateway billing</h2>
                            <p className="mt-4 leading-7 text-muted-foreground">
                                Twilio pricing varies by country, segment, carrier fees, and number type. As examples,
                                Twilio lists US SMS from about $0.0083 per inbound or outbound segment before some
                                carrier fees, and Cyprus outbound SMS at $0.0864 per segment.
                            </p>
                            <p className="mt-4 leading-7 text-muted-foreground">
                                SIM Relay is best for agencies with steady local SMS volume where a carrier bundle
                                or unlimited SMS plan is cheaper than gateway billing.
                            </p>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <a
                                href="https://www.twilio.com/en-us/sms/pricing/us"
                                className="rounded-lg border bg-background p-5 transition-colors hover:bg-muted/60"
                                target="_blank"
                                rel="noreferrer"
                            >
                                <p className="text-sm font-medium text-muted-foreground">Twilio US example</p>
                                <p className="mt-2 text-3xl font-semibold">$0.0083</p>
                                <p className="mt-2 text-sm text-muted-foreground">per SMS segment listed for long codes</p>
                            </a>
                            <a
                                href="https://www.twilio.com/en-us/sms/pricing/cy"
                                className="rounded-lg border bg-background p-5 transition-colors hover:bg-muted/60"
                                target="_blank"
                                rel="noreferrer"
                            >
                                <p className="text-sm font-medium text-muted-foreground">Twilio Cyprus example</p>
                                <p className="mt-2 text-3xl font-semibold">$0.0864</p>
                                <p className="mt-2 text-sm text-muted-foreground">per outbound SMS segment listed</p>
                            </a>
                        </div>
                    </div>
                </section>

                <section className="border-b bg-slate-50 py-16 dark:bg-slate-900/40">
                    <div className="container mx-auto grid max-w-6xl gap-8 px-4 lg:grid-cols-[1fr_0.9fr]">
                        <div>
                            <h2 className="text-3xl font-semibold tracking-tight">No surprise SMS parts</h2>
                            <p className="mt-4 leading-7 text-muted-foreground">
                                A text can look like one message to a customer but still count as multiple billable
                                SMS parts behind the scenes. Long messages, emojis, and special punctuation can
                                increase the number of parts your carrier or gateway counts.
                            </p>
                            <p className="mt-4 leading-7 text-muted-foreground">
                                In Android SMS mode, Estio previews the part count before sending, such as 1 SMS part
                                or 2 SMS parts. Long messages still send normally, and Estio keeps the full text as one
                                clean CRM conversation message.
                            </p>
                        </div>
                        <div className="rounded-lg border bg-background p-6">
                            <p className="text-sm font-medium text-muted-foreground">Example</p>
                            <p className="mt-3 text-lg font-semibold">A short reminder may be 1 SMS part.</p>
                            <p className="mt-3 leading-7 text-muted-foreground">
                                A longer follow-up with emojis or curly quotes can become 2 or more parts. Estio warns
                                agents before sending so they can shorten the message when cost matters.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="py-16">
                    <div className="container mx-auto max-w-6xl px-4">
                        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
                            <div>
                                <h2 className="text-3xl font-semibold tracking-tight">How to install SIM Relay</h2>
                                <p className="mt-3 max-w-2xl text-muted-foreground">
                                    The APK download and pairing tools are available after login so each device is
                                    connected to the right Estio location.
                                </p>
                            </div>
                            <Button asChild variant="outline">
                                <Link href="/admin/settings/integrations/sms-relay">
                                    <Download className="mr-2 h-4 w-4" />
                                    Open setup
                                </Link>
                            </Button>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                            {setupSteps.map((step, index) => (
                                <div key={step.title} className="flex gap-4 rounded-lg border bg-background p-5">
                                    <div className="flex h-9 w-9 flex-none items-center justify-center rounded-md bg-blue-600 text-sm font-semibold text-white">
                                        {index + 1}
                                    </div>
                                    <div>
                                        <h3 className="font-semibold">{step.title}</h3>
                                        <p className="mt-1 text-sm leading-6 text-muted-foreground">{step.text}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                <section className="bg-slate-50 py-16 dark:bg-slate-900/40">
                    <div className="container mx-auto max-w-6xl px-4">
                        <div className="mb-8 max-w-3xl">
                            <h2 className="text-3xl font-semibold tracking-tight">Trust, safety, and compliance</h2>
                            <p className="mt-3 text-muted-foreground">
                                SIM Relay is built for controlled operational messaging, with pairing and queueing
                                designed around real device behavior.
                            </p>
                        </div>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            {trustItems.map((item) => (
                                <div key={item.title} className="rounded-lg border bg-background p-5">
                                    <item.icon className="h-5 w-5 text-blue-600" />
                                    <h3 className="mt-4 font-semibold">{item.title}</h3>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.text}</p>
                                </div>
                            ))}
                        </div>
                        <div className="mt-6 flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-5 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none" />
                            <p className="text-sm leading-6">
                                You remain responsible for consent, opt-out handling, carrier rules, and local SMS
                                regulations. SIM Relay changes the sending path; it does not remove compliance duties.
                            </p>
                        </div>
                    </div>
                </section>

                <section className="py-16">
                    <div className="container mx-auto max-w-4xl px-4">
                        <h2 className="text-3xl font-semibold tracking-tight">FAQ</h2>
                        <div className="mt-8 divide-y rounded-lg border bg-background">
                            {faqs.map((faq) => (
                                <div key={faq.question} className="p-5">
                                    <h3 className="font-semibold">{faq.question}</h3>
                                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{faq.answer}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
            </div>
        </PageWrapper>
    );
}
