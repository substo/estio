"use client";

import { useState, useActionState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updateHomeConfig } from "@/app/(main)/admin/content/actions";
import { useFormStatus } from "react-dom";
import { BlockEditor } from "@/app/(main)/admin/content/pages/_components/block-editor";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function SubmitButton() {
    const { pending } = useFormStatus();
    return <Button disabled={pending}>{pending ? "Saving Configuration..." : "Save Home Page"}</Button>;
}

const initialState = {
    message: "",
    success: false,
};

export function HomePageForm({ initialBlocks, siteConfig }: { initialBlocks: any[]; siteConfig: any }) {
    const [blocks, setBlocks] = useState<any[]>(() => {
        // Auto-populate defaults for Categories if missing items
        return initialBlocks.map(block => {
            if (block.type === 'categories' && (!block.items || block.items.length === 0)) {
                return {
                    ...block,
                    items: [
                        { title: "New Build Villas", filter: { type: "villa", condition: "New Build", status: "sale" } },
                        { title: "Resale Villas", filter: { type: "villa", condition: "Resale", status: "sale" } },
                        { title: "Resale Apartments", filter: { type: "apartment", condition: "Resale", status: "sale" } },
                        { title: "New Build Apartments", filter: { type: "apartment", condition: "New Build", status: "sale" } },
                        { title: "Commercial", filter: { type: "commercial", status: "sale" } },
                        { title: "Land", filter: { type: "land", status: "sale" } },
                        { title: "Rentals", filter: { status: "rent" } }
                    ]
                };
            }
            return block;
        });
    });

    // @ts-ignore
    const [state, formAction] = useActionState(async (prevState: any, formData: FormData) => {
        const blocksJson = formData.get('blocks');
        console.log("Submitting Blocks:", blocksJson);
        const result = await updateHomeConfig(prevState, formData);
        if (result?.message) {
            if (result.success) toast.success(result.message);
            else toast.error(result.message);
        }
        return result;
    }, initialState);

    const addSystemBlock = (type: "featured-properties" | "trusted-partners" | "categories") => {
        if (blocks.some(b => b.type === type)) {
            toast.error(`This section is already added.`);
            return;
        }
        setBlocks(prev => [...prev, { type, enabled: true }]);
    };

    const addHeroBlock = () => {
        if (blocks.some(b => b.type === "hero")) {
            toast.error(`Only one Hero section is currently supported.`);
            return;
        }
        setBlocks(prev => [...prev, { type: "hero", layout: "full-width", headline: "Welcome Home" }]);
    }

    return (
        <div className="space-y-8 max-w-4xl">
            <div className="p-4 border rounded-lg bg-blue-50/50 space-y-2">
                <h3 className="font-medium text-blue-900">Home Page Configuration</h3>
                <p className="text-sm text-blue-700">
                    Control the layout and content of your public home page.
                    <br />
                    Use the blocks below to reorder sections.
                </p>
            </div>

            <form action={formAction} className="space-y-6">
                <input type="hidden" name="locationId" value={siteConfig.locationId} />
                <input type="hidden" name="blocks" value={JSON.stringify(blocks)} />

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Page Sections</Label>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="outline">
                                    <Plus className="w-4 h-4 mr-2" /> Add Section
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={addHeroBlock}>Hero Section</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => addSystemBlock("categories")}>Categories (Search Grid)</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => addSystemBlock("featured-properties")}>Featured Properties</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => addSystemBlock("trusted-partners")}>Trusted Partners</DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>

                    <BlockEditor
                        blocks={blocks}
                        onChange={setBlocks}
                        onPreview={() => window.open(`http://${siteConfig.domain}${siteConfig.domain.includes('localhost') ? ':3000' : ''}`, '_blank')}
                        siteConfig={siteConfig}
                    />
                </div>

                {state?.message && !state?.success && (
                    <div className="p-3 rounded bg-red-100 border border-red-200 text-red-700 text-sm">
                        {state.message}
                    </div>
                )}

                <SubmitButton />
            </form>
        </div>
    );
}
