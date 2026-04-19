"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Sparkles, Loader2, CheckCircle2 } from "lucide-react";
import { translatePropertyFields, savePropertyTranslation, getPropertyTranslations } from "../translation-actions";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

interface PropertyTranslationPanelProps {
    propertyId: string;
    locationId: string;
    language: string;
    sourceTitle: string;
    sourceDescription: string;
    sourceMetaTitle?: string;
    sourceMetaDescription?: string;
}

export function PropertyTranslationPanel({
    propertyId,
    locationId,
    language,
    sourceTitle,
    sourceDescription,
    sourceMetaTitle,
    sourceMetaDescription
}: PropertyTranslationPanelProps) {
    const [isLoading, setIsLoading] = useState(true);
    const [isTranslating, setIsTranslating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [metaTitle, setMetaTitle] = useState("");
    const [metaDescription, setMetaDescription] = useState("");
    
    // Tracking AI state
    const [isAiGenerated, setIsAiGenerated] = useState(false);
    const [hasTranslation, setHasTranslation] = useState(false);

    useEffect(() => {
        if (!propertyId || propertyId === "new") {
            setIsLoading(false);
            return;
        }
        
        setIsLoading(true);
        getPropertyTranslations(locationId, propertyId)
            .then((translations) => {
                const target = translations.find((t: any) => t.languageCode === language);
                if (target) {
                    setTitle(target.title || "");
                    setDescription(target.description || "");
                    setMetaTitle(target.metaTitle || "");
                    setMetaDescription(target.metaDescription || "");
                    setIsAiGenerated(target.isAiGenerated);
                    setHasTranslation(true);
                } else {
                    setTitle("");
                    setDescription("");
                    setMetaTitle("");
                    setMetaDescription("");
                    setIsAiGenerated(false);
                    setHasTranslation(false);
                }
            })
            .catch((err) => {
                console.error("Failed to load translation:", err);
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [propertyId, locationId, language]);

    const handleAITranslate = async () => {
        if (!propertyId || propertyId === "new") {
            toast.error("Save the property in English first before translating.");
            return;
        }

        setIsTranslating(true);
        try {
            const result = await translatePropertyFields(locationId, propertyId, language, {
                title: sourceTitle,
                description: sourceDescription,
                metaTitle: sourceMetaTitle,
                metaDescription: sourceMetaDescription
            });

            setTitle(result.title);
            setDescription(result.description);
            setMetaTitle(result.metaTitle);
            setMetaDescription(result.metaDescription);
            setIsAiGenerated(true);
            setHasTranslation(true);

            // Auto-save the AI generation
            await handleSave(result.title, result.description, result.metaTitle, result.metaDescription, true);
            toast.success(`Translated to ${language.toUpperCase()} successfully.`);
        } catch (err: any) {
            toast.error("Translation failed", { description: err.message });
        } finally {
            setIsTranslating(false);
        }
    };

    const handleSave = async (
        t: string = title, 
        d: string = description, 
        mt: string = metaTitle, 
        md: string = metaDescription, 
        aiGen: boolean = isAiGenerated
    ) => {
        if (!propertyId || propertyId === "new") return;
        
        setIsSaving(true);
        try {
            await savePropertyTranslation(locationId, propertyId, language, {
                title: t,
                description: d,
                metaTitle: mt,
                metaDescription: md,
                isAiGenerated: aiGen
            });
            setHasTranslation(true);
            if (!aiGen) {
                toast.success("Translation saved.");
            }
        } catch (err: any) {
            toast.error("Failed to save translation", { description: err.message });
        } finally {
            setIsSaving(false);
        }
    };

    // Mark as human-verified if a human types
    const markHumanEdit = () => {
        if (isAiGenerated) {
            setIsAiGenerated(false);
        }
    };

    if (isLoading) {
        return (
            <div className="flex flex-col items-center justify-center p-8 border rounded-lg bg-gray-50/50 col-span-2">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground mt-2">Loading {language.toUpperCase()} translation...</p>
            </div>
        );
    }

    if (!hasTranslation && !isTranslating) {
        return (
            <div className="col-span-2 flex flex-col items-center justify-center p-8 border border-dashed rounded-lg bg-blue-50/30">
                <p className="text-sm text-gray-500 mb-4">No {language.toUpperCase()} localization found.</p>
                <Button onClick={handleAITranslate} variant="default" className="bg-blue-600 hover:bg-blue-700 text-white gap-2">
                    <Sparkles className="h-4 w-4" />
                    Translate automatically with AI
                </Button>
            </div>
        );
    }

    return (
        <div className="col-span-2 space-y-4 p-4 border rounded-lg bg-blue-50/10 relative">
            {isTranslating && (
                <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] flex items-center justify-center z-10 rounded-lg">
                    <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm border">
                        <Sparkles className="h-4 w-4 text-blue-500 animate-pulse" />
                        <span className="text-sm font-medium">Translating to {language.toUpperCase()}...</span>
                    </div>
                </div>
            )}
            
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">{language} Localization</h3>
                    {isAiGenerated ? (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100 text-[10px] uppercase font-semibold">
                            AI Generated - Review Needed
                        </Badge>
                    ) : (
                         <Badge variant="outline" className="border-green-200 text-green-700 bg-green-50 text-[10px] uppercase font-semibold gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Human Verified
                        </Badge>
                    )}
                </div>
                <div className="flex gap-2">
                    {hasTranslation && (
                        <Button 
                            onClick={handleAITranslate} 
                            variant="outline" 
                            size="sm" 
                            className="text-xs gap-1 opacity-70 hover:opacity-100"
                            title="Re-translate from English"
                        >
                            <Sparkles className="h-3 w-3" /> Re-translate
                        </Button>
                    )}
                    <Button 
                        onClick={() => handleSave()} 
                        disabled={isSaving || isTranslating}
                        size="sm" 
                        variant="secondary"
                    >
                        {isSaving ? "Saving..." : "Save Draft"}
                    </Button>
                </div>
            </div>

            <div className="space-y-2">
                <Label htmlFor={`trans-title-${language}`}>Title ({language.toUpperCase()})</Label>
                <Input 
                    id={`trans-title-${language}`}
                    value={title} 
                    onChange={(e) => { setTitle(e.target.value); markHumanEdit(); }} 
                    onBlur={() => handleSave()}
                    className={isAiGenerated ? "border-amber-200 focus-visible:ring-amber-500" : ""}
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor={`trans-desc-${language}`}>Description ({language.toUpperCase()})</Label>
                <div className={isAiGenerated ? "ring-1 ring-amber-200 rounded-md" : ""}>
                    <RichTextEditor
                        content={description}
                        onChange={(val) => { setDescription(val); markHumanEdit(); }}
                        placeholder={`Translated description in ${language.toUpperCase()}...`}
                        className="min-h-[150px]"
                    />
                </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-blue-100/50">
                <div className="space-y-2">
                    <Label htmlFor={`trans-meta-${language}`}>Meta Title ({language.toUpperCase()})</Label>
                    <Input 
                        id={`trans-meta-${language}`}
                        value={metaTitle} 
                        onChange={(e) => { setMetaTitle(e.target.value); markHumanEdit(); }} 
                        onBlur={() => handleSave()}
                        className="bg-transparent"
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor={`trans-meta-desc-${language}`}>Meta Description ({language.toUpperCase()})</Label>
                    <Input 
                        id={`trans-meta-desc-${language}`}
                        value={metaDescription} 
                        onChange={(e) => { setMetaDescription(e.target.value); markHumanEdit(); }} 
                        onBlur={() => handleSave()}
                        className="bg-transparent"
                    />
                </div>
            </div>
        </div>
    );
}
