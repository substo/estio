import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getActiveContactsAccess } from "@/lib/contacts/active-location-access";

type SettingsSection = {
  title: string;
  description: string;
  href: string;
  actionLabel: string;
  requiresAdmin?: boolean;
};

const SETTINGS_SECTIONS: SettingsSection[] = [
  {
    title: "Widget Configuration",
    description: "Customize your public website domain, theme, and hero section.",
    href: "/admin/site-settings",
    actionLabel: "Public Website & Theme",
  },
  {
    title: "Team Management",
    description: "Manage team members and GHL calendar assignments.",
    href: "/admin/team",
    actionLabel: "Manage Team",
    requiresAdmin: true,
  },
  {
    title: "Location Data",
    description: "Preview the location-owned records that an administrative cleanup would erase or retain.",
    href: "/admin/settings/location-data",
    actionLabel: "Review Location Data",
    requiresAdmin: true,
  },
  {
    title: "AI Configuration",
    description: "Manage AI models, API keys, and brand voice settings.",
    href: "/admin/settings/ai",
    actionLabel: "Manage AI",
  },
  {
    title: "Prospecting",
    description: "Manage external scraping targets to discover new leads.",
    href: "/admin/settings/prospecting",
    actionLabel: "Manage Scraping",
  },
  {
    title: "Notifications",
    description: "Manage your task reminder timing, quiet hours, and browser push devices.",
    href: "/admin/settings/notifications",
    actionLabel: "Manage Notifications",
  },
  {
    title: "Media Management",
    description: "View trashed images, restore accidentally removed photos, and purge expired assets from Cloudflare.",
    href: "/admin/settings/media",
    actionLabel: "Manage Media",
  },
  {
    title: "Integrations",
    description: "Manage CRM, messaging, workspace, and AI service connections.",
    href: "/admin/settings/integrations",
    actionLabel: "Manage Integrations",
  },
];

function SettingsCard({ section }: { section: SettingsSection }) {
  return (
    <Card>
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-lg">{section.title}</CardTitle>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <Button variant="outline" asChild>
          <Link href={section.href}>{section.actionLabel}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default async function SettingsPage() {
  const access = await getActiveContactsAccess();
  const isAdmin = access?.role === "ADMIN";
  const visibleSections = SETTINGS_SECTIONS.filter((section) => !section.requiresAdmin || isAdmin);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        {visibleSections.map((section) => (
          <SettingsCard key={section.href} section={section} />
        ))}
      </div>
    </div>
  );
}
