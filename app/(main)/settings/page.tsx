import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { requireSettingsContext } from "./_components/context";
import { visibleSettingsSections } from "./_components/sections";

export default async function SettingsIndexPage() {
  const { app, access, tenantHost } = await requireSettingsContext();
  if (!access) return null;
  const sections = visibleSettingsSections(app, access.role, tenantHost, Boolean((await auth()).actor));
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
    <ul className="divide-y rounded-xl border">
      {sections.map(section => <li key={section.href}>
        <Link href={section.href} className="block p-4 hover:bg-accent focus-visible:bg-accent">
          <span className="font-medium">{section.label}</span>
          <span className="block text-sm text-muted-foreground">{section.description}</span>
        </Link>
      </li>)}
    </ul>
  </main>;
}
