"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Save } from "lucide-react";
import { saveFooterDisclaimer } from "../actions";
import { toast } from "sonner";

export function FooterDisclaimerEditor({ initialText }: { initialText: string }) {
    const [text, setText] = useState(initialText || "");
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveFooterDisclaimer(text);
            toast.success("Footer disclaimer saved");
        } catch (e) {
            toast.error("Failed to save disclaimer");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border rounded-md p-4 space-y-4 bg-white shadow-sm">
            <div className="flex justify-between items-center border-b pb-4">
                <h3 className="font-semibold">Footer Text / License</h3>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : <><Save className="w-3 h-3 mr-2" /> Save</>}
                </Button>
            </div>

            <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">
                    This text will appear below the copyright notice.
                    <br />
                    Example: License No. 123/E | Reg No. 456
                </Label>
                <Textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Enter license details or additional disclaimer..."
                    className="min-h-[80px]"
                />
            </div>
        </div>
    );
}
