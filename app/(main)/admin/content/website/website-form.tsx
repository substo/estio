"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveSubstoWebsiteAction, type WebsiteFormState } from "./actions";
import type { WebsiteSettings } from "@/lib/substo-sites/policy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
function SaveButton() { const { pending } = useFormStatus(); return <Button disabled={pending}>{pending ? "Saving…" : "Save website"}</Button>; }
export function WebsiteForm({ slug, published, settings, origin }: { slug: string; published: boolean; settings: WebsiteSettings; origin: string }) {
  const [state, action] = useActionState(saveSubstoWebsiteAction, {} as WebsiteFormState);
  return <form action={action} className="max-w-2xl space-y-6">
    <div className="space-y-2"><Label htmlFor="site-slug">Website address</Label><div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">{origin}/sites/</span><Input id="site-slug" name="slug" defaultValue={slug} required minLength={3} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></div><label className="flex items-center gap-2 text-sm"><input name="confirmAddressChange" type="checkbox" />Confirm if changing the address. Existing links will stop working.</label></div>
    <div className="space-y-2"><Label htmlFor="site-title">Public brand name</Label><Input id="site-title" name="title" defaultValue={settings.title} required maxLength={150} /></div>
    <div className="space-y-2"><Label htmlFor="site-description">Description</Label><Textarea id="site-description" name="description" defaultValue={settings.description} maxLength={1000} /></div>
    <div className="space-y-2"><Label htmlFor="site-email">Public contact email (optional)</Label><Input id="site-email" name="email" type="email" defaultValue={settings.email} maxLength={254} /></div>
    <div className="space-y-2"><Label htmlFor="site-logo">Logo URL (optional)</Label><Input id="site-logo" name="logoUrl" type="url" placeholder="https://" defaultValue={settings.logoUrl} maxLength={2048} /></div>
    <div className="space-y-2"><Label htmlFor="site-accent">Brand colour</Label><Input id="site-accent" name="accent" type="color" defaultValue={settings.accent} className="h-10 w-20" /></div>
    <label className="flex items-start gap-3 rounded-lg border p-4"><input type="checkbox" name="published" defaultChecked={published} className="mt-1" /><span><span className="font-medium">Publish website</span><span className="mt-1 block text-sm text-muted-foreground">Make the public brand name, description, contact details and published pages/posts available to anyone. Turn off to hide the whole website.</span></span></label>
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}{state.message ? <p role="status" className="text-sm">{state.message}</p> : null}<SaveButton />
  </form>;
}
