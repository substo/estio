"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { saveSubstoWebsiteAction, type WebsiteFormState } from "./actions";
import type { WebsiteSettings } from "@/lib/substo-sites/policy";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
function SaveButton() { const { pending } = useFormStatus(); return <Button disabled={pending}>{pending ? "Saving…" : "Save website"}</Button>; }
export function WebsiteForm({ slug, published, settings, origin }: { slug: string; published: boolean; settings: WebsiteSettings; origin: string }) {
  const [state, action] = useActionState(saveSubstoWebsiteAction, {} as WebsiteFormState);
  return <form action={action} className="max-w-2xl space-y-6">
    <div className="space-y-2"><Label htmlFor="site-slug">Website address</Label><div className="flex items-center gap-2"><span className="text-sm text-muted-foreground">{origin}/sites/</span><Input id="site-slug" name="slug" defaultValue={slug} required minLength={3} maxLength={63} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></div><label className="flex items-center gap-2 text-sm"><input name="confirmAddressChange" type="checkbox" />Confirm if changing the address. Existing links will stop working.</label></div>
    {Object.entries(settings).map(([key, value]) => <input key={key} type="hidden" name={key} value={value} />)}
    <label className="flex items-start gap-3 rounded-lg border p-4"><input type="checkbox" name="published" defaultChecked={published} className="mt-1" /><span><span className="font-medium">Publish website</span><span className="mt-1 block text-sm text-muted-foreground">Make the public brand name, description, contact details and published pages/posts available to anyone. Turn off to hide the whole website.</span></span></label>
    {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}{state.message ? <p role="status" className="text-sm">{state.message}</p> : null}<SaveButton />
  </form>;
}
