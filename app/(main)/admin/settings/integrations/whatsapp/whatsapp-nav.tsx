import Link from "next/link";

const links = [
    { href: "/admin/settings/integrations/whatsapp", label: "Connections" },
    { href: "/admin/settings/integrations/whatsapp/linked-phone", label: "Linked phone" },
    { href: "/admin/settings/integrations/whatsapp/meta", label: "Meta business" },
];

export function WhatsAppNav() {
    return (
        <nav aria-label="WhatsApp settings" className="flex flex-wrap gap-2">
            {links.map((link) => (
                <Link
                    key={link.href}
                    href={link.href}
                    className="inline-flex min-h-10 items-center rounded-md border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    {link.label}
                </Link>
            ))}
        </nav>
    );
}
