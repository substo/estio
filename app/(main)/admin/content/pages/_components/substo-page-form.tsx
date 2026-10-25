"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { upsertPage } from "../../actions";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BlockEditor } from "./block-editor";
function SaveButton() { const { pending } = useFormStatus(); return <Button disabled={pending}>{pending ? "Saving…" : "Save page"}</Button>; }
export function SubstoPageForm({ page, locationId }: { page: { id: string; title: string; slug: string; content: string | null; blocks: unknown; published: boolean; metaTitle: string | null; metaDescription: string | null } | null; locationId: string }) {
  const [state, action] = useActionState(upsertPage, { message: "" });
  const [content, setContent] = useState(page?.content || "");
  const [blocks, setBlocks] = useState<any[]>(Array.isArray(page?.blocks) ? page.blocks : []);
  const preview = () => { if (page) window.open(`/admin/content/pages/${encodeURIComponent(page.id)}/preview`, "_blank", "noopener,noreferrer"); };
  return <form action={action} className="max-w-4xl space-y-6">
    <input type="hidden" name="id" value={page?.id || ""} /><input type="hidden" name="locationId" value={locationId} />
    <input type="hidden" name="content" value={content} /><input type="hidden" name="blocks" value={JSON.stringify(blocks)} />
    <div className="space-y-2"><Label htmlFor="page-title">Page title</Label><Input id="page-title" name="title" defaultValue={page?.title} required /></div>
    <div className="space-y-2"><Label htmlFor="page-slug">Page address</Label><Input id="page-slug" name="slug" defaultValue={page?.slug} required placeholder="about-us" /><p className="text-sm text-muted-foreground">Use “home” for your website homepage.</p></div>
    <div className="space-y-3"><Label>Content</Label>{blocks.length ? <><p className="text-sm text-muted-foreground">This page uses sections. Static text, images and links are published; forms and property widgets are not included.</p><BlockEditor blocks={blocks} onChange={setBlocks} onPreview={preview} siteConfig={{ locationId }} /></> : <RichTextEditor value={content} onChange={setContent} />}</div>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="page-meta-title">Search title (optional)</Label><Input id="page-meta-title" name="metaTitle" defaultValue={page?.metaTitle || ""} /></div><div className="space-y-2"><Label htmlFor="page-meta-description">Search description (optional)</Label><Input id="page-meta-description" name="metaDescription" defaultValue={page?.metaDescription || ""} /></div></div>
    <label className="flex items-center gap-3"><input type="checkbox" name="published" defaultChecked={page?.published} />Publish page when the brand website is live</label>
    <div className="flex flex-wrap items-center gap-4"><SaveButton />{page ? <a className="text-sm underline" href={`/admin/content/pages/${encodeURIComponent(page.id)}/preview`} target="_blank" rel="noopener noreferrer">Preview saved page</a> : <span className="text-sm text-muted-foreground">Save the page to preview it.</span>}</div>
    {state.message ? <p role="status" className="text-sm">{state.message}</p> : null}
  </form>;
}
