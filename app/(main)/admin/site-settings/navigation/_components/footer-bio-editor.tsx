"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";
import { saveFooterBio } from "../actions";
import { toast } from "sonner";

export function FooterBioEditor({ initialText }: { initialText: string }) {
    const [text, setText] = useState(initialText || "");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveFooterBio(text);
            toast.success("Footer description saved");
        } catch (e) {
            toast.error("Failed to save description");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border rounded-md p-4 space-y-4 bg-white shadow-sm">
            <div className="flex justify-between items-center border-b pb-4">
                <h3 className="font-semibold">Footer Brand Description</h3>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : <><Save className="w-3 h-3 mr-2" /> Save</>}
                </Button>
            </div>

            <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                    This text appears below your logo/brand name in the footer.
                </Label>
                <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Your trusted partner in real estate. We bring professionalism and local expertise to every transaction."
                    className="min-h-[80px]"
                />
            </div>
        </div>
    );
}
