"use client";

import { useState, useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFormStatus } from "react-dom";
import { updateSubmissionsConfig } from "@/app/(main)/admin/content/actions";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { MediaGalleryDialog } from "@/components/media/MediaGalleryDialog";

function SubmitButton() {
    const { pending } = useFormStatus();
    return <Button disabled={pending}>{pending ? "Saving..." : "Save Submissions Page"}</Button>;
}

const initialState = {
    message: "",
    success: false,
};

export function SubmissionsPageForm({ config, siteConfig }: { config: any; siteConfig: any }) {
    // defaults
    const defaults = {
        title: "My Submissions",
        emptyTitle: "No submissions yet",
        emptyBody: "You haven't submitted any properties yet. Click 'List Your Property' to get started.",
        headerStyle: "solid",
        heroImage: ""
    };

    const current = { ...defaults, ...config };
    const [headerStyle, setHeaderStyle] = useState(current.headerStyle);
    const [heroImageUrl, setHeroImageUrl] = useState(current.heroImage || "");

    // @ts-ignore
    const [state, formAction] = useActionState(async (prevState: any, formData: FormData) => {
        const result = await updateSubmissionsConfig(prevState, formData);
        if (result?.message) {
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
        }
        return result;
    }, initialState);

    return (
        <div className="space-y-6 max-w-2xl">
            <div className="flex items-center gap-4 mb-6">
                <Link href="/admin/content/pages">
                    <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
                </Link>
                <div>
                    <h1 className="text-2xl font-bold">Edit Submissions Page</h1>
                    <p className="text-sm text-muted-foreground">Customize the layout and text of the public submissions page.</p>
                </div>
            </div>

            <form action={formAction} className="space-y-8">
                <input type="hidden" name="locationId" value={siteConfig.locationId} />

                <div className="space-y-4 border p-4 rounded-md">
                    <h3 className="font-medium">General Settings</h3>

                    <div className="space-y-2">
                        <Label>Page Title</Label>
                        <Input name="title" defaultValue={current.title} placeholder="My Submissions" />
                    </div>
                </div>

                <div className="space-y-4 border p-4 rounded-md">
                    <h3 className="font-medium">SEO Settings</h3>
                    <div className="space-y-2">
                        <Label>Meta Title</Label>
                        <Input name="metaTitle" defaultValue={current.metaTitle} placeholder="My Submissions | Brand Name" />
                    </div>
                    <div className="space-y-2">
                        <Label>Meta Description</Label>
                        <Textarea name="metaDescription" defaultValue={current.metaDescription} placeholder="View your submitted properties..." rows={2} />
                    </div>
                </div>

                <div className="space-y-4 border p-4 rounded-md">
                    <h3 className="font-medium">Visual Settings</h3>

                    <div className="space-y-2">
                        <Label>Header Style</Label>
                        <Select name="headerStyle" defaultValue={current.headerStyle} onValueChange={setHeaderStyle}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="solid">Solid (White/Dark)</SelectItem>
                                <SelectItem value="transparent">Transparent (Overlay)</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                            "Transparent" requires a Hero Image to look correct. "Solid" adds a standard header bar.
                        </p>
                    </div>

                    {headerStyle === 'transparent' && (
                        <div className="space-y-2">
                            <Label>Hero Background Image</Label>
                            <input type="hidden" name="heroImage" value={heroImageUrl} />
                            <div className="p-4 border border-dashed rounded-md bg-slate-50">
                                <div className="flex items-center gap-4">
                                    {heroImageUrl && (
                                        <div className="w-24 h-16 rounded overflow-hidden bg-slate-200 flex-shrink-0">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={heroImageUrl} alt="Hero Preview" className="w-full h-full object-cover" />
                                        </div>
                                    )}
                                    <MediaGalleryDialog
                                        onSelect={(url) => setHeroImageUrl(url)}
                                        siteConfig={siteConfig}
                                        trigger={<Button type="button" variant="outline">Browse Images</Button>}
                                    />
                                    {heroImageUrl && (
                                        <Button type="button" variant="ghost" size="sm" onClick={() => setHeroImageUrl("")}>Clear</Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="space-y-4 border p-4 rounded-md">
                    <h3 className="font-medium">Empty State</h3>
                    <p className="text-sm text-muted-foreground">Shown when the user has submitted no properties.</p>

                    <div className="space-y-2">
                        <Label>Title</Label>
                        <Input name="emptyTitle" defaultValue={current.emptyTitle} placeholder="No submissions yet" />
                    </div>

                    <div className="space-y-2">
                        <Label>Body Text</Label>
                        <Textarea name="emptyBody" defaultValue={current.emptyBody} placeholder="You haven't submitted..." rows={3} />
                    </div>
                </div>

                <SubmitButton />
            </form>
        </div>
    );
}
