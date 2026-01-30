import Link from "next/link";
import { Button } from "@/components/ui/button";
import { currentUser } from "@clerk/nextjs/server";
import { auth } from "@clerk/nextjs/server";

export default async function SettingsPage() {

  const { userId } = await auth();
  const user = await currentUser();
  const isAdmin = user?.publicMetadata?.ghlRole === 'admin' || user?.publicMetadata?.ghlRole === 'agency';

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
        <div className="p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Widget Configuration</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Customize your public website domain, theme, and hero section.
          </p>
          <Link href="/admin/site-settings">
            <Button variant="outline">Public Website & Theme</Button>
          </Link>
        </div>

        {isAdmin && (
          <div className="p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
            <h2 className="text-lg font-semibold mb-2">Team Management</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Manage team members and GHL calendar assignments.
            </p>
            <Link href="/admin/team">
              <Button variant="outline">Manage Team</Button>
            </Link>
          </div>
        )}

        {/* CRM Integration Card */}
        <div className="p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
          <h2 className="text-lg font-semibold mb-2">CRM Integration</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Connect to the old CRM to enable property imports.
          </p>
          <Link href="/admin/settings/crm">
            <Button variant="outline">Manage Credentials</Button>
          </Link>
        </div>

        {/* AI Configuration Card */}
        <div className="p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
          <h2 className="text-lg font-semibold mb-2">AI Configuration</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Manage AI models, API keys, and brand voice settings.
          </p>
          <Link href="/admin/settings/ai">
            <Button variant="outline">Manage AI</Button>
          </Link>
        </div>

        {/* Integrations Card */}
        <div className="p-4 border rounded-lg bg-card text-card-foreground shadow-sm">
          <h2 className="text-lg font-semibold mb-2">Integrations</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Manage external connections like WhatsApp Business.
          </p>
          <Link href="/admin/settings/integrations">
            <Button variant="outline">Manage Integrations</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
