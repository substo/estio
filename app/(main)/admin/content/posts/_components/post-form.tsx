"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { upsertPost } from "@/app/(main)/admin/content/actions";
import { useFormStatus, useFormState } from "react-dom";
import { CloudflareImageUploader } from "@/components/media/CloudflareImageUploader";
import { getImageDeliveryUrl } from "@/lib/cloudflareImages";
import Image from "next/image";

function SubmitButton() {
    const { pending } = useFormStatus();
    return <Button disabled={pending}>{pending ? "Saving..." : "Save Post"}</Button>;
}

const initialState = {
    message: "",
};

export function PostForm({ initialData, locationId }: { initialData?: any, locationId: string }) {
    const [content, setContent] = useState(initialData?.content || "");
    const [coverImageId, setCoverImageId] = useState(initialData?.coverImage || "");
    // @ts-ignore
    const [state, formAction] = useFormState(upsertPost, initialState);

    return (
        <form action={formAction} className="space-y-6 max-w-3xl">
            <input type="hidden" name="id" value={initialData?.id || ""} />

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label>Post Title</Label>
                    <Input name="title" defaultValue={initialData?.title} required placeholder="e.g. Market Analysis" />
                </div>
                <div className="space-y-2">
                    <Label>URL Slug</Label>
                    <Input name="slug" defaultValue={initialData?.slug} required placeholder="e.g. market-analysis" />
                </div>
            </div>

            <div className="space-y-2">
                <Label>Cover Image</Label>
                <div className="border border-dashed rounded-lg p-4 bg-gray-50">
                    {coverImageId && (
                        <div className="mb-4 relative h-40 w-full rounded-md overflow-hidden bg-white border">
                            <Image src={getImageDeliveryUrl(coverImageId, 'public')} alt="Preview" fill className="object-cover" />
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="absolute top-2 right-2"
                                onClick={() => setCoverImageId("")}
                            >Remove</Button>
                        </div>
                    )}
                    {!coverImageId && (
                        <CloudflareImageUploader
                            locationId={locationId}
                            onUploaded={(id) => setCoverImageId(id)}
                        />
                    )}
                </div>
                <input type="hidden" name="coverImage" value={coverImageId} />
            </div>

            <div className="space-y-2">
                <Label>Content</Label>
                <RichTextEditor value={content} onChange={setContent} />
                <input type="hidden" name="content" value={content} />
            </div>

            <div className="flex items-center space-x-2">
                <Switch name="published" defaultChecked={initialData?.published} id="published" />
                <Label htmlFor="published">Publish (Visible on Blog)</Label>
            </div>

            {state?.message && (
                <div className="p-3 rounded bg-red-100 border border-red-200 text-red-700 text-sm">
                    {state.message}
                </div>
            )}

            <SubmitButton />
        </form>
    );
}
