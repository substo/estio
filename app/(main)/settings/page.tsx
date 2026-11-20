import Link from "next/link";
import { SETTINGS_SECTIONS } from "./_components/sections";

export default function SettingsIndexPage() {
  return <main className="max-w-3xl space-y-4">
    <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
    <ul className="divide-y rounded-xl border">
      {SETTINGS_SECTIONS.map(section => <li key={section.href}>
        <Link href={section.href} className="block p-4 hover:bg-accent focus-visible:bg-accent">
          <span className="font-medium">{section.label}</span>
          <span className="block text-sm text-muted-foreground">{section.description}</span>
        </Link>
      </li>)}
    </ul>
  </main>;
}
