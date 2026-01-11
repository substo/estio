"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Trash,
    Save,
    Facebook,
    Instagram,
    Linkedin,
    Twitter,
    Youtube,
    Link as LinkIcon,
    Globe,
    Phone
} from "lucide-react";
import { saveNavigation } from "../actions";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SocialLink {
    platform: string;
    url: string;
}

const PLATFORMS = [
    { value: "facebook", label: "Facebook", icon: Facebook },
    { value: "instagram", label: "Instagram", icon: Instagram },
    { value: "linkedin", label: "LinkedIn", icon: Linkedin },
    { value: "twitter", label: "X (Twitter)", icon: Twitter },
    { value: "youtube", label: "YouTube", icon: Youtube },
    { value: "tiktok", label: "TikTok", icon: Globe }, // Lucide might not have TikTok, using Globe as fallback
    { value: "whatsapp", label: "WhatsApp", icon: Phone },
    { value: "pinterest", label: "Pinterest", icon: LinkIcon }, // Fallback
    { value: "other", label: "Other", icon: LinkIcon },
];

export function SocialLinksEditor({ initialLinks = [] }: { initialLinks?: SocialLink[] }) {
    const [links, setLinks] = useState<SocialLink[]>(initialLinks || []);
    const [saving, setSaving] = useState(false);

    const addLink = () => setLinks([...links, { platform: "facebook", url: "" }]);

    const updateLink = (index: number, field: keyof SocialLink, value: string) => {
        const newLinks = [...links];
        newLinks[index] = { ...newLinks[index], [field]: value };
        setLinks(newLinks);
    };

    const removeLink = (index: number) => {
        setLinks(links.filter((_, i) => i !== index));
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            await saveNavigation('social', links);
            toast.success("Social links saved");
        } catch (e) {
            toast.error("Failed to save social links");
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border rounded-md p-4 space-y-4 bg-white shadow-sm">
            <div className="flex justify-between items-center border-b pb-4">
                <h3 className="font-semibold capitalize flex items-center gap-2">
                    Social Media Links
                    <span className="text-xs font-normal text-muted-foreground bg-gray-100 px-2 py-0.5 rounded-full">{links.length} links</span>
                </h3>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? "Saving..." : <><Save className="w-3 h-3 mr-2" /> Save</>}
                </Button>
            </div>

            <div className="space-y-3">
                {links.length === 0 && (
                    <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
                        No social links added.
                    </div>
                )}
                {links.map((link, index) => {
                    const PlatformIcon = PLATFORMS.find(p => p.value === link.platform)?.icon || LinkIcon;

                    return (
                        <div key={index} className="flex gap-2 items-start p-2 border rounded-lg bg-gray-50/50">
                            <div className="pt-2 text-gray-400">
                                <PlatformIcon className="w-4 h-4" />
                            </div>
                            <div className="flex-1 flex gap-2">
                                <Select
                                    value={link.platform}
                                    onValueChange={(val) => updateLink(index, 'platform', val)}
                                >
                                    <SelectTrigger className="w-[140px]">
                                        <SelectValue placeholder="Platform" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {PLATFORMS.map(p => (
                                            <SelectItem key={p.value} value={p.value}>
                                                <div className="flex items-center gap-2">
                                                    <p.icon className="w-3 h-3" />
                                                    {p.label}
                                                </div>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>

                                <Input
                                    value={link.url}
                                    onChange={(e) => updateLink(index, 'url', e.target.value)}
                                    placeholder="https://"
                                    className="flex-1"
                                />
                            </div>

                            <Button variant="ghost" size="icon" onClick={() => removeLink(index)} className="text-red-500 hover:text-red-700 hover:bg-red-50">
                                <Trash className="w-4 h-4" />
                            </Button>
                        </div>
                    );
                })}
            </div>

            <Button variant="outline" size="sm" className="w-full border-dashed" onClick={addLink}>
                + Add Social Link
            </Button>
        </div>
    );
}
