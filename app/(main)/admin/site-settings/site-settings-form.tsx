"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateSiteSettings } from "./actions";
import { Input } from "@/components/ui/input";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { MediaUploader } from "@/components/ui/media-uploader";
import { X, Sparkles, Loader2, ChevronDown, ChevronUp, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
import Link from "next/link";

const initialState = {
    message: "",
    errors: {},
};

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending ? "Saving..." : "Save Changes"}
        </Button>
    );
}

export function SiteSettingsForm({
    initialData,
    locationId,
    locationName
}: {
    initialData: any,
    locationId: string,
    locationName: string
}) {
    const [state, action] = useActionState(updateSiteSettings, initialState);

    // Safe access to JSON fields
    const theme = initialData?.theme as any || {};
    const hero = initialData?.heroContent as any || {};

    // --- STATE FOR CONTROLLED INPUTS (AI DESIGNER) ---
    const [brandName, setBrandName] = useState<string>(theme.logo?.textTop || "");
    const [brandTagline, setBrandTagline] = useState<string>(theme.logo?.textBottom || "");
    const [primaryColor, setPrimaryColor] = useState<string>(theme.primaryColor || initialData?.primaryColor || "#000000");
    // Advanced Colors
    const [secondaryColor, setSecondaryColor] = useState<string>(theme.secondaryColor || initialData?.secondaryColor || "#ffffff");
    const [accentColor, setAccentColor] = useState<string>(theme.accentColor || initialData?.accentColor || "#f5f5f5");
    const [backgroundColor, setBackgroundColor] = useState<string>(theme.backgroundColor || "#ffffff");
    const [textColor, setTextColor] = useState<string>(theme.textColor || "#000000");


    const [logoUrl, setLogoUrl] = useState<string>(theme.logo?.url || "");
    const [lightLogoUrl, setLightLogoUrl] = useState<string>(theme.logo?.lightUrl || "");
    const [iconUrl, setIconUrl] = useState<string>(theme.logo?.iconUrl || "");
    const [faviconUrl, setFaviconUrl] = useState<string>(theme.logo?.faviconUrl || "");

    // Removed duplicate navLinks state management
    const [headerStyle, setHeaderStyle] = useState<string>(theme.headerStyle || "transparent");

    // AI Designer State
    const [aiInstruction, setAiInstruction] = useState("");
    const [isGeneratingTheme, setIsGeneratingTheme] = useState(false);
    const [useResearchUrl, setUseResearchUrl] = useState(false);
    const [researchUrl, setResearchUrl] = useState("");
    const [isAdvancedColorsOpen, setIsAdvancedColorsOpen] = useState(false);

    const handleAiThemeGenerate = async () => {
        if (!aiInstruction && !useResearchUrl) {
            toast.error("Please enter instructions or enable URL research.");
            return;
        }

        setIsGeneratingTheme(true);
        try {
            const { generateSiteTheme } = await import("@/app/(main)/admin/content/ai-actions");
            const currentConfig = { brandName, brandTagline, primaryColor };

            // Determine research URL
            let targetResearchUrl = undefined;
            if (useResearchUrl) {
                const domainInput = document.getElementById("domain") as HTMLInputElement;
                // Use local researchUrl state
                targetResearchUrl = researchUrl || (domainInput?.value ? `https://${domainInput?.value}` : undefined);

                if (!targetResearchUrl) {
                    toast.error("Enter an Existing Website URL to research.");
                    setIsGeneratingTheme(false);
                    return;
                }
            }

            const result = await generateSiteTheme(locationId, aiInstruction || "Generate a theme.", currentConfig, targetResearchUrl);

            if (result.success && result.theme) {
                // Auto-fill form
                if (result.theme.brandName) setBrandName(result.theme.brandName);
                if (result.theme.brandTagline) setBrandTagline(result.theme.brandTagline);
                if (result.theme.primaryColor) setPrimaryColor(result.theme.primaryColor);
                toast.success("Theme generated! Review changes below.");
            } else {
                toast.error(result.error || "Failed to generate theme.");
            }
        } catch (error) {
            console.error(error);
            toast.error("Something went wrong.");
        } finally {
            setIsGeneratingTheme(false);
        }
    };

    // --- PREVIEW COMPONENT ---
    const ThemePreview = () => (
        <div className="border rounded-xl overflow-hidden shadow-sm mt-6">
            <div className="bg-gray-100 border-b px-4 py-2 text-xs font-medium text-gray-500 flex justify-between items-center">
                <span>Theme Preview</span>
                <span className="bg-white px-2 py-0.5 rounded border text-[10px]">Live Updates</span>
            </div>
            {/* Mock Header */}
            <div className="border-b px-6 py-4 flex justify-between items-center" style={{ backgroundColor: backgroundColor }}>
                <div>
                    <h4 className="font-bold text-lg leading-tight" style={{ color: primaryColor }}>{brandName || "Brand Name"}</h4>
                    {brandTagline && <p className="text-xs" style={{ color: textColor }}>{brandTagline}</p>}
                </div>
                <nav className="hidden md:flex gap-4 text-sm font-medium" style={{ color: textColor }}>
                    <span>Home</span>
                    <span>About</span>
                    <span>Services</span>
                    <span className="px-3 py-1.5 rounded-full text-white text-xs" style={{ backgroundColor: primaryColor }}>Contact</span>
                </nav>
            </div>
            {/* Mock Hero */}
            <div className="relative h-64 flex flex-col items-center justify-center text-center px-4 overflow-hidden" style={{ backgroundColor: accentColor }}>
                {hero.backgroundImage && <img src={hero.backgroundImage} className="absolute inset-0 w-full h-full object-cover opacity-20" alt="Hero BG" />}
                <div className="relative z-10 max-w-lg space-y-3">
                    <h2 className="text-3xl font-extrabold tracking-tight" style={{ color: textColor }}>{hero.headline || "Your Main Headline"}</h2>
                    <p className="text-lg opacity-80" style={{ color: textColor }}>{hero.subheadline || "Subheadline goes here describing the value proposition."}</p>
                    <div className="pt-2">
                        <button className="px-6 py-2.5 rounded-lg text-white font-medium shadow-md hover:opacity-90 transition-opacity" style={{ backgroundColor: primaryColor }}>
                            Get Started
                        </button>
                    </div>
                </div>
            </div>
            {/* Mock Features (Demonstrating Secondary Color) */}
            <div className="grid grid-cols-2 gap-4 p-6" style={{ backgroundColor: secondaryColor }}>
                <div className="bg-white/50 p-4 rounded-lg flex items-center justify-center text-sm font-medium" style={{ color: textColor }}>
                    Feature 1
                </div>
                <div className="bg-white/50 p-4 rounded-lg flex items-center justify-center text-sm font-medium" style={{ color: textColor }}>
                    Feature 2
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-8">
            {/* AI DESIGNER PANEL */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-4 opacity-10">
                    <Sparkles className="w-24 h-24 text-indigo-600" />
                </div>
                <div className="relative z-10">
                    <div className="flex items-center gap-2 mb-2 text-indigo-700">
                        <Sparkles className="w-5 h-5" />
                        <h3 className="text-lg font-bold">AI Theme Designer</h3>
                    </div>

                    <div className="space-y-4">
                        <p className="text-sm text-indigo-600/80 max-w-lg">
                            Describe your style or provide a URL to extract branding from.
                        </p>

                        <div className="flex items-center gap-2">
                            <input
                                type="checkbox"
                                id="useResearchUrl"
                                className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                checked={useResearchUrl}
                                onChange={(e) => setUseResearchUrl(e.target.checked)}
                            />
                            <label htmlFor="useResearchUrl" className="text-sm font-medium text-indigo-900 cursor-pointer select-none">
                                Research details from "Existing Website URL"
                            </label>
                        </div>

                        {useResearchUrl && (
                            <Input
                                placeholder="https://example.com"
                                className="bg-white border-indigo-200 focus-visible:ring-indigo-500 mb-2"
                                value={researchUrl}
                                onChange={(e) => setResearchUrl(e.target.value)}
                            />
                        )}

                        <div className="flex gap-3">
                            <Input
                                placeholder={useResearchUrl ? 'Additional context (e.g. "Focus on the blue tones")' : 'Describe your desired theme...'}
                                className="bg-white border-indigo-200 focus-visible:ring-indigo-500"
                                value={aiInstruction}
                                onChange={(e) => setAiInstruction(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAiThemeGenerate(); } }}
                            />
                            <Button
                                onClick={handleAiThemeGenerate}
                                disabled={isGeneratingTheme}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white min-w-[140px]"
                            >
                                {isGeneratingTheme ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Designing...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4 mr-2" />
                                        {useResearchUrl ? "Research & Apply" : "Auto-Fill"}
                                    </>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
            </div>

            {/* PREVIEW SECTION */}
            <ThemePreview />

            <form action={action} className="space-y-8">
                <input type="hidden" name="locationId" value={locationId} />


                {/* Domain Section */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Domain Configuration</h3>
                    <div className="grid gap-2">
                        <Label htmlFor="locationName">Location Name</Label>
                        <Input
                            id="locationName"
                            name="locationName"
                            placeholder="e.g. Downtown Cyprus"
                            defaultValue={locationName}
                        />
                        <p className="text-sm text-muted-foreground">
                            Internal location/business name stored on the Location record.
                        </p>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="domain">Custom Domain (or Subdomain)</Label>
                        <Input
                            id="domain"
                            name="domain"
                            placeholder="properties.myagency.com"
                            defaultValue={initialData?.domain || ""}
                        />
                        <p className="text-sm text-muted-foreground">
                            Enter the domain where this site will be accessed.
                        </p>
                        {state?.errors?.domain && (
                            <p className="text-sm text-red-500">{state.errors.domain[0]}</p>
                        )}
                    </div>
                </div>

                <Separator />

                {/* AI Settings Redirect */}
                <div className="flex items-center gap-2 p-4 bg-muted/30 rounded-lg">
                    <div className="p-2 bg-indigo-50 rounded text-indigo-600">
                        <Sparkles className="w-5 h-5" />
                    </div>
                    <div>
                        <h4 className="font-semibold text-sm">AI Configuration</h4>
                        <p className="text-xs text-muted-foreground">
                            Manage AI models, API keys, and brand voice in the dedicated <Link href="/admin/settings/ai" className="text-indigo-600 hover:underline">AI Settings</Link> page.
                        </p>
                    </div>
                </div>

                <Separator />

                {/* Theme & Branding Section */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Theme & Branding</h3>

                    <input type="hidden" name="logoUrl" value={logoUrl} />
                    <input type="hidden" name="lightLogoUrl" value={lightLogoUrl} />
                    <input type="hidden" name="iconUrl" value={iconUrl} />
                    <input type="hidden" name="faviconUrl" value={faviconUrl} />

                    {/* Brand Identity */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <Label>Brand Logo</Label>
                            {logoUrl ? (
                                <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-gray-100 flex items-center justify-center">
                                    <img src={logoUrl} alt="Brand Logo" className="max-w-full max-h-full object-contain p-2" />
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-2 right-2 h-6 w-6"
                                        onClick={() => setLogoUrl("")}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            ) : (
                                <MediaUploader
                                    locationId={locationId}
                                    onUploadComplete={(url) => setLogoUrl(url)}
                                    label="Upload Logo"
                                    maxSizeMB={5}
                                />
                            )}
                            <p className="text-xs text-muted-foreground">Main Logo (Dark Color) - Used on White Header.</p>
                        </div>

                        <div className="space-y-4">
                            <Label>Alternative Logo (Light/White)</Label>
                            {lightLogoUrl ? (
                                <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-slate-800 flex items-center justify-center">
                                    <img src={lightLogoUrl} alt="Light Logo" className="max-w-full max-h-full object-contain p-2" />
                                    <Button
                                        type="button"
                                        variant="destructive"
                                        size="icon"
                                        className="absolute top-2 right-2 h-6 w-6"
                                        onClick={() => setLightLogoUrl("")}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            ) : (
                                <MediaUploader
                                    locationId={locationId}
                                    onUploadComplete={(url) => setLightLogoUrl(url)}
                                    label="Upload Light Logo"
                                    maxSizeMB={5}
                                />
                            )}
                            <p className="text-xs text-muted-foreground">Used on Transparent Header (Dark Backgrounds).</p>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="space-y-4">
                                <Label>Brand Icon (UI)</Label>
                                {iconUrl ? (
                                    <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-gray-100 flex items-center justify-center">
                                        <img src={iconUrl} alt="Brand Icon" className="max-w-full max-h-full object-contain p-2" />
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            className="absolute top-2 right-2 h-6 w-6"
                                            onClick={() => setIconUrl("")}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                ) : (
                                    <MediaUploader
                                        locationId={locationId}
                                        onUploadComplete={(url) => setIconUrl(url)}
                                        label="Upload Icon"
                                        maxSizeMB={2}
                                    />
                                )}
                                <p className="text-xs text-muted-foreground">Displayed in Header/Footer next to text.</p>
                            </div>

                            <div className="space-y-4">
                                <Label>Favicon (Browser Tab)</Label>
                                {faviconUrl ? (
                                    <div className="relative w-full h-32 rounded-lg overflow-hidden border bg-gray-100 flex items-center justify-center">
                                        <img src={faviconUrl} alt="Favicon" className="max-w-full max-h-full object-contain p-2" />
                                        <Button
                                            type="button"
                                            variant="destructive"
                                            size="icon"
                                            className="absolute top-2 right-2 h-6 w-6"
                                            onClick={() => setFaviconUrl("")}
                                        >
                                            <X className="h-3 w-3" />
                                        </Button>
                                    </div>
                                ) : (
                                    <MediaUploader
                                        locationId={locationId}
                                        onUploadComplete={(url) => setFaviconUrl(url)}
                                        label="Upload Favicon"
                                        maxSizeMB={1}
                                    />
                                )}
                                <p className="text-xs text-muted-foreground">Displayed in the browser tab. (.ico, .png, .jpg)</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="brandName">Brand Name (Top Line)</Label>
                                <Input
                                    id="brandName"
                                    name="brandName"
                                    placeholder="e.g. DOWN TOWN"
                                    value={brandName}
                                    onChange={(e) => setBrandName(e.target.value)}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="brandTagline">Tagline (Bottom Line)</Label>
                                <Input
                                    id="brandTagline"
                                    name="brandTagline"
                                    placeholder="e.g. REAL ESTATE AGENCY"
                                    value={brandTagline}
                                    onChange={(e) => setBrandTagline(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 pt-4">
                        <div className="grid gap-2">
                            <Label htmlFor="primaryColor">Primary Brand Color</Label>
                            <div className="flex gap-2">
                                <Input
                                    id="primaryColor"
                                    name="primaryColor"
                                    type="color"
                                    className="w-12 h-10 p-1"
                                    value={primaryColor}
                                    onChange={(e) => setPrimaryColor(e.target.value)}
                                />
                                <Input
                                    disabled
                                    placeholder="#000000"
                                    value={primaryColor}
                                    className="flex-1"
                                />
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Main buttons, highlights, and active states.
                            </p>
                        </div>
                    </div>

                    <Collapsible
                        open={isAdvancedColorsOpen}
                        onOpenChange={setIsAdvancedColorsOpen}
                        className="border rounded-lg p-4 bg-muted/20"
                    >
                        <CollapsibleTrigger asChild>
                            <Button variant="ghost" size="sm" className="w-full justify-between p-0 hover:bg-transparent">
                                <span className="text-sm font-semibold text-gray-700">Advanced Color Palette</span>
                                {isAdvancedColorsOpen ? (
                                    <ChevronUp className="h-4 w-4 text-gray-500" />
                                ) : (
                                    <ChevronDown className="h-4 w-4 text-gray-500" />
                                )}
                            </Button>
                        </CollapsibleTrigger>
                        <CollapsibleContent className="space-y-4 pt-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="secondaryColor">Secondary Color</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="secondaryColor"
                                            name="secondaryColor"
                                            type="color"
                                            className="w-12 h-10 p-1"
                                            value={secondaryColor}
                                            onChange={(e) => setSecondaryColor(e.target.value)}
                                        />
                                        <Input
                                            disabled
                                            value={secondaryColor}
                                            className="flex-1"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">Used for backgrounds, cards, and subtle elements.</p>
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="accentColor">Accent / Hero Background</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="accentColor"
                                            name="accentColor"
                                            type="color"
                                            className="w-12 h-10 p-1"
                                            value={accentColor}
                                            onChange={(e) => setAccentColor(e.target.value)}
                                        />
                                        <Input
                                            disabled
                                            value={accentColor}
                                            className="flex-1"
                                        />
                                    </div>
                                    <p className="text-xs text-muted-foreground">Used for large hero areas or decorative accents.</p>
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="backgroundColor">Page Background</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="backgroundColor"
                                            name="backgroundColor"
                                            type="color"
                                            className="w-12 h-10 p-1"
                                            value={backgroundColor}
                                            onChange={(e) => setBackgroundColor(e.target.value)}
                                        />
                                        <Input
                                            disabled
                                            value={backgroundColor}
                                            className="flex-1"
                                        />
                                    </div>
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="textColor">Main Text Color</Label>
                                    <div className="flex gap-2">
                                        <Input
                                            id="textColor"
                                            name="textColor"
                                            type="color"
                                            className="w-12 h-10 p-1"
                                            value={textColor}
                                            onChange={(e) => setTextColor(e.target.value)}
                                        />
                                        <Input
                                            disabled
                                            value={textColor}
                                            className="flex-1"
                                        />
                                    </div>
                                </div>
                            </div>
                        </CollapsibleContent>
                    </Collapsible>

                </div>

                <Separator />

                {/* Contact Information Section */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Contact Information (Footer)</h3>
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="contactAddress">Address</Label>
                            <Input
                                id="contactAddress"
                                name="contactAddress"
                                placeholder="123 Makariou Avenue, Limassol"
                                defaultValue={initialData?.contactInfo?.address || ""}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="contactMapsLink">Google Maps Link</Label>
                            <Input
                                id="contactMapsLink"
                                name="contactMapsLink"
                                placeholder="https://maps.google.com/..."
                                defaultValue={initialData?.contactInfo?.mapsLink || ""}
                            />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="contactMapsLinkTitle">Google Maps Link Title (SEO)</Label>
                            <Input
                                id="contactMapsLinkTitle"
                                name="contactMapsLinkTitle"
                                placeholder="e.g. My Agency - Real Estate in City"
                                defaultValue={initialData?.contactInfo?.mapsLinkTitle || ""}
                            />
                            <p className="text-sm text-muted-foreground">
                                Use your brand name + category + location (e.g. "Down Town Cyprus - Real Estate Agency in Paphos"). This will be the link text, with the address displayed below.
                            </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label htmlFor="contactMobile">Mobile Number</Label>
                                <Input
                                    id="contactMobile"
                                    name="contactMobile"
                                    placeholder="+357 99 123 456"
                                    defaultValue={initialData?.contactInfo?.mobile || initialData?.contactInfo?.phone || ""}
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="contactLandline">Landline Number</Label>
                                <Input
                                    id="contactLandline"
                                    name="contactLandline"
                                    placeholder="+357 25 123 456"
                                    defaultValue={initialData?.contactInfo?.landline || ""}
                                />
                            </div>
                            <div className="grid gap-2 md:col-span-2">
                                <Label htmlFor="contactEmail">Email</Label>
                                <Input
                                    id="contactEmail"
                                    name="contactEmail"
                                    placeholder="info@example.com"
                                    defaultValue={initialData?.contactInfo?.email || ""}
                                />
                            </div>
                        </div>
                    </div>
                </div>

                <Separator />

                {/* Header Style Section */}
                <div className="space-y-4">
                    <h3 className="text-lg font-medium">Header Configuration</h3>
                    <div className="grid gap-4">
                        <div className="grid gap-2">
                            <Label htmlFor="headerStyle">Default Header Style</Label>
                            <select
                                id="headerStyle"
                                name="headerStyle"
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                value={headerStyle}
                                onChange={(e) => setHeaderStyle(e.target.value)}
                            >
                                <option value="transparent">Transparent (Overlay)</option>
                                <option value="solid">Solid Color (Background)</option>
                            </select>
                            <p className="text-sm text-muted-foreground">
                                <strong>Transparent:</strong> Header background is clear, overlaying the hero image. Becomes solid on scroll.<br />
                                <strong>Solid:</strong> Header has a solid background color at all times.
                            </p>
                        </div>
                    </div>
                </div>

                <Separator />

                <div className="flex items-center gap-2 p-4 bg-muted/30 rounded-lg">
                    <div className="p-2 bg-indigo-50 rounded text-indigo-600">
                        <ExternalLink className="w-5 h-5" />
                    </div>
                    <div>
                        <h4 className="font-semibold text-sm">Navigation Menu</h4>
                        <p className="text-xs text-muted-foreground">
                            Manage your site&apos;s header and footer links in the dedicated <Link href="/admin/site-settings/navigation" className="text-indigo-600 hover:underline">Navigation Builder</Link>.
                        </p>
                    </div>
                </div>


                {state?.errors?._form && (
                    <div className="p-3 bg-red-100 text-red-700 text-sm rounded-md">
                        {state.errors._form}
                    </div>
                )}

                {state?.message && (
                    <div className="p-3 bg-green-100 text-green-700 text-sm rounded-md">
                        {state.message}
                    </div>
                )}

                <div className="flex justify-end">
                    <SubmitButton />
                </div>
            </form>
        </div>
    );
}
