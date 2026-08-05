"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
    ArrowLeft,
    Database,
    ExternalLink,
    FileSearch,
    KeyRound,
    MailCheck,
    RefreshCw,
    Route,
    Save,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
    analyzeLeadSchema,
    clearOldCrmSettingsSection,
    getCrmSettings,
    getLeadSources,
    saveCrmCredentials,
    saveLeadSchema,
    saveLegacyCrmLeadEmailSettings,
} from "../../crm/actions";
import type { OldCrmSettingsSection } from "@/lib/crm/clear-old-crm-settings";
import { analyzeCrmSchema, saveCrmSchema } from "../../../properties/import/actions";
import { LeadSourceManager } from "../../crm/_components/lead-source-manager";
import { ClearSettingsButton } from "./_components/clear-settings-button";

type CrmSettingsFormValues = {
    locationId: string;
    settingsVersion: number;
    crmUrl: string;
    crmUsername: string;
    crmPassword: string;
    hasCrmPassword: boolean;
    crmEditUrlPattern: string;
    crmLeadUrlPattern: string;
    publicListingUrlMode: string;
    legacyPublicListingUrlPattern: string;
    legacyCrmLeadEmailEnabled: boolean;
    legacyCrmLeadEmailSenders: string;
    legacyCrmLeadEmailSenderDomains: string;
    legacyCrmLeadEmailSubjectPatterns: string;
    legacyCrmLeadEmailPinConversation: boolean;
    legacyCrmLeadEmailAutoProcess: boolean;
    legacyCrmLeadEmailAutoDraftFirstContact: boolean;
};

const DEFAULT_CRM_SETTINGS: CrmSettingsFormValues = {
    locationId: "",
    settingsVersion: 0,
    crmUrl: "",
    crmUsername: "",
    crmPassword: "",
    hasCrmPassword: false,
    crmEditUrlPattern: "",
    crmLeadUrlPattern: "",
    publicListingUrlMode: "ESTIO",
    legacyPublicListingUrlPattern: "",
    legacyCrmLeadEmailEnabled: false,
    legacyCrmLeadEmailSenders: "",
    legacyCrmLeadEmailSenderDomains: "",
    legacyCrmLeadEmailSubjectPatterns: "",
    legacyCrmLeadEmailPinConversation: true,
    legacyCrmLeadEmailAutoProcess: false,
    legacyCrmLeadEmailAutoDraftFirstContact: false,
};

function listToTextareaValue(value: unknown, fallback: string) {
    return Array.isArray(value) ? value.join("\n") : fallback;
}

function normalizeCrmSettings(settings: any): CrmSettingsFormValues {
    return {
        locationId: settings.locationId || DEFAULT_CRM_SETTINGS.locationId,
        settingsVersion: Number(settings.settingsVersion || DEFAULT_CRM_SETTINGS.settingsVersion),
        crmUrl: settings.crmUrl ?? DEFAULT_CRM_SETTINGS.crmUrl,
        crmUsername: settings.crmUsername ?? DEFAULT_CRM_SETTINGS.crmUsername,
        crmPassword: "",
        hasCrmPassword: Boolean(settings.hasCrmPassword),
        crmEditUrlPattern: settings.crmEditUrlPattern ?? DEFAULT_CRM_SETTINGS.crmEditUrlPattern,
        crmLeadUrlPattern: settings.crmLeadUrlPattern ?? DEFAULT_CRM_SETTINGS.crmLeadUrlPattern,
        publicListingUrlMode: settings.publicListingUrlMode ?? DEFAULT_CRM_SETTINGS.publicListingUrlMode,
        legacyPublicListingUrlPattern: settings.legacyPublicListingUrlPattern ?? DEFAULT_CRM_SETTINGS.legacyPublicListingUrlPattern,
        legacyCrmLeadEmailEnabled: !!settings.legacyCrmLeadEmailEnabled,
        legacyCrmLeadEmailSenders: listToTextareaValue(
            settings.legacyCrmLeadEmailSenders,
            DEFAULT_CRM_SETTINGS.legacyCrmLeadEmailSenders
        ),
        legacyCrmLeadEmailSenderDomains: listToTextareaValue(
            settings.legacyCrmLeadEmailSenderDomains,
            DEFAULT_CRM_SETTINGS.legacyCrmLeadEmailSenderDomains
        ),
        legacyCrmLeadEmailSubjectPatterns: listToTextareaValue(
            settings.legacyCrmLeadEmailSubjectPatterns,
            DEFAULT_CRM_SETTINGS.legacyCrmLeadEmailSubjectPatterns
        ),
        legacyCrmLeadEmailPinConversation: settings.legacyCrmLeadEmailPinConversation ?? DEFAULT_CRM_SETTINGS.legacyCrmLeadEmailPinConversation,
        legacyCrmLeadEmailAutoProcess: !!settings.legacyCrmLeadEmailAutoProcess,
        legacyCrmLeadEmailAutoDraftFirstContact: !!settings.legacyCrmLeadEmailAutoDraftFirstContact,
    };
}

function SectionIcon({ icon: Icon }: { icon: LucideIcon }) {
    return (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-background">
            <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
    );
}

function FormHint({ children }: { children: React.ReactNode }) {
    return <p className="text-xs leading-5 text-muted-foreground">{children}</p>;
}

export default function OldCrmIntegrationPage() {
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingLegacyLeadEmail, setIsSavingLegacyLeadEmail] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isLeadAnalyzing, setIsLeadAnalyzing] = useState(false);
    const [schema, setSchema] = useState<any>(null);
    const [defaultValues, setDefaultValues] = useState(DEFAULT_CRM_SETTINGS);
    const [leadAnalysisUrl, setLeadAnalysisUrl] = useState("https://www.downtowncyprus.com/admin/leads/create");
    const [leadAnalysisResult, setLeadAnalysisResult] = useState<any>(null);

    async function refreshSavedSettings(options: { updatePasswordState?: boolean } = {}) {
        const settings: any = await getCrmSettings(defaultValues.locationId || null);
        if (!settings) return;

        setDefaultValues((prev) => ({
            ...prev,
            settingsVersion: Number(settings.settingsVersion || prev.settingsVersion || 0),
            ...(options.updatePasswordState
                ? {
                    hasCrmPassword: Boolean(settings.hasCrmPassword),
                    crmPassword: "",
                }
                : {}),
        }));
    }

    useEffect(() => {
        async function fetchSettings() {
            try {
                const settings: any = await getCrmSettings();
                if (settings) {
                    setDefaultValues(normalizeCrmSettings(settings));
                    if (settings.crmSchema) setSchema(settings.crmSchema);
                    if (settings.crmLeadSchema) setLeadAnalysisResult(settings.crmLeadSchema);
                }
            } catch (error) {
                console.error("Failed to fetch settings:", error);
            }
        }
        fetchSettings();
    }, []);

    async function onAnalyze() {
        setIsAnalyzing(true);
        try {
            const result = await analyzeCrmSchema();
            if (result.success) {
                setSchema(result.schema);
                toast.success("Schema analyzed successfully");
            } else {
                toast.error("Analysis failed: " + result.error);
            }
        } catch (error: any) {
            toast.error("An error occurred: " + error.message);
        } finally {
            setIsAnalyzing(false);
        }
    }

    async function onSubmitLegacyCrmLeadEmail(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsSavingLegacyLeadEmail(true);

        const formData = new FormData(event.currentTarget);
        const data = Object.fromEntries(formData);

        try {
            const result = await saveLegacyCrmLeadEmailSettings(data);
            if (result?.success) {
                toast.success("Legacy CRM lead email settings saved");
                await refreshSavedSettings();
            } else {
                toast.error(result?.error || "Failed to save settings");
            }
        } catch (error: any) {
            toast.error(error?.message || "Failed to save settings");
        } finally {
            setIsSavingLegacyLeadEmail(false);
        }
    }

    async function onAnalyzeLead() {
        if (!leadAnalysisUrl) {
            toast.error("Please enter a URL");
            return;
        }
        setIsLeadAnalyzing(true);
        try {
            const result = await analyzeLeadSchema(leadAnalysisUrl, defaultValues.locationId || null);
            if (result.success) {
                setLeadAnalysisResult(result.analysis);
                toast.success("Lead page analyzed successfully");
            } else {
                toast.error("Analysis failed: " + result.error);
            }
        } catch (error: any) {
            console.error("Client side error calling analyzeLeadSchema:", error);
            toast.error("An error occurred: " + error.message);
        } finally {
            setIsLeadAnalyzing(false);
        }
    }

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setIsSaving(true);

        const formData = new FormData(event.currentTarget);
        const data = Object.fromEntries(formData);

        try {
            const result = await saveCrmCredentials(data);
            if (!result?.success) {
                toast.error(result?.error || "Failed to save credentials");
                return;
            }
            toast.success("Old CRM settings saved");
            await refreshSavedSettings({ updatePasswordState: true });
        } catch (error) {
            toast.error("Failed to save settings");
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    }

    async function onClearSection(section: OldCrmSettingsSection, label: string) {
        try {
            const result = await clearOldCrmSettingsSection(section);
            if (!result?.success) {
                toast.error(result?.error || `Failed to clear ${label.toLowerCase()}`);
                return false;
            }

            const settings = await getCrmSettings();
            if (settings) setDefaultValues(normalizeCrmSettings(settings));
            if (section === "PROPERTY_SCHEMA") setSchema(null);
            if (section === "LEAD_SCHEMA") setLeadAnalysisResult(null);
            toast.success(`${label} cleared`);
            return true;
        } catch (error) {
            console.error(error);
            toast.error(`Failed to clear ${label.toLowerCase()}`);
            return false;
        }
    }

    const legacyModeEnabled = defaultValues.publicListingUrlMode === "LEGACY_EXTERNAL";

    return (
        <div className="mx-auto w-full max-w-6xl space-y-6 p-6">
            <div className="space-y-4">
                <Button variant="ghost" size="sm" asChild className="w-fit px-0">
                    <Link href="/admin/settings/integrations">
                        <ArrowLeft className="mr-2 h-4 w-4" />
                        Integrations
                    </Link>
                </Button>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                        <h1 className="text-2xl font-bold tracking-tight">Old CRM Integration</h1>
                        <p className="max-w-3xl text-sm text-muted-foreground">
                            Connect the legacy admin site, control customer-facing listing URLs during migration, and configure lead import tooling.
                        </p>
                    </div>
                    <Badge variant={legacyModeEnabled ? "default" : "secondary"} className="w-fit">
                        {legacyModeEnabled ? "Legacy public links active" : "Estio public links active"}
                    </Badge>
                </div>
            </div>

            <form onSubmit={onSubmit} className="space-y-6">
                <input type="hidden" name="locationId" value={defaultValues.locationId} />
                <input type="hidden" name="settingsVersion" value={String(defaultValues.settingsVersion)} />

                <Card>
                    <CardHeader>
                        <div className="flex items-start gap-3">
                            <SectionIcon icon={KeyRound} />
                            <div>
                                <CardTitle>Connection</CardTitle>
                                <CardDescription>
                                    Login details used by property and lead import automation for the old admin panel.
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="crmUrl">Admin URL</Label>
                                <Input
                                    id="crmUrl"
                                    name="crmUrl"
                                    defaultValue={defaultValues.crmUrl}
                                    key={defaultValues.crmUrl}
                                    placeholder="https://www.downtowncyprus.com/admin"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="crmUsername">Username</Label>
                                <Input
                                    id="crmUsername"
                                    name="crmUsername"
                                    defaultValue={defaultValues.crmUsername}
                                    key={`user-${defaultValues.crmUsername}`}
                                    placeholder="admin"
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="crmPassword">Password</Label>
                                <Input
                                    id="crmPassword"
                                    name="crmPassword"
                                    type="password"
                                    defaultValue={defaultValues.crmPassword}
                                    key={`pass-${defaultValues.crmPassword}`}
                                    placeholder={defaultValues.hasCrmPassword ? "Leave blank to keep existing password" : "Enter CRM password"}
                                />
                                <FormHint>
                                    {defaultValues.hasCrmPassword
                                        ? "Password is already configured. Leave blank to keep it."
                                        : "No password configured yet."}
                                </FormHint>
                            </div>
                        </div>
                        <label className="flex w-fit items-center gap-2 text-sm">
                            <input type="checkbox" name="clearCrmPassword" className="h-4 w-4" />
                            Clear stored password
                        </label>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex items-start gap-3">
                            <SectionIcon icon={Route} />
                            <div>
                                <CardTitle>Property Import And Public Links</CardTitle>
                                <CardDescription>
                                    Configure edit routes for old CRM records and decide which public listing URLs customers receive.
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="crmEditUrlPattern">Property Edit URL Pattern</Label>
                                <Input
                                    id="crmEditUrlPattern"
                                    name="crmEditUrlPattern"
                                    defaultValue={defaultValues.crmEditUrlPattern}
                                    key={`pattern-${defaultValues.crmEditUrlPattern}`}
                                    placeholder="https://site.com/admin/properties/{id}/edit"
                                />
                                <FormHint>
                                    Use <code>{"{id}"}</code> as the placeholder for the old CRM property ID.
                                </FormHint>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="crmLeadUrlPattern">Lead Edit URL Pattern</Label>
                                <Input
                                    id="crmLeadUrlPattern"
                                    name="crmLeadUrlPattern"
                                    defaultValue={defaultValues.crmLeadUrlPattern}
                                    key={`pattern-lead-${defaultValues.crmLeadUrlPattern}`}
                                    placeholder="https://site.com/admin/leads/{id}/edit"
                                />
                                <FormHint>
                                    Use <code>{"{id}"}</code> as the placeholder for the old CRM lead ID.
                                </FormHint>
                            </div>
                        </div>

                        <Separator />

                        <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_1fr]">
                            <div className="space-y-2">
                                <Label htmlFor="publicListingUrlMode">Customer Listing Link Mode</Label>
                                <select
                                    id="publicListingUrlMode"
                                    name="publicListingUrlMode"
                                    defaultValue={defaultValues.publicListingUrlMode}
                                    key={`public-mode-${defaultValues.publicListingUrlMode}`}
                                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                >
                                    <option value="ESTIO">Use Estio public listing URLs</option>
                                    <option value="LEGACY_EXTERNAL">Use old CRM public listing URLs</option>
                                </select>
                                <FormHint>Admin preview links still open Estio property pages.</FormHint>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="legacyPublicListingUrlPattern">Old CRM Public URL Pattern</Label>
                                <Input
                                    id="legacyPublicListingUrlPattern"
                                    name="legacyPublicListingUrlPattern"
                                    defaultValue={defaultValues.legacyPublicListingUrlPattern}
                                    key={`public-pattern-${defaultValues.legacyPublicListingUrlPattern}`}
                                    placeholder="https://www.downtowncyprus.com/properties/{slug}"
                                />
                                <FormHint>
                                    Supports <code>{"{slug}"}</code>, <code>{"{reference}"}</code>, and <code>{"{oldCrmId}"}</code>. Imported listings can also store an exact external public URL.
                                </FormHint>
                            </div>
                        </div>

                        <div className="flex justify-end gap-2">
                            <ClearSettingsButton
                                title="Clear connection and link settings?"
                                items={[
                                    "Old CRM admin URL and property, lead, and public-link patterns",
                                    "Your saved Old CRM username and password",
                                    "Customer listing links return to Estio mode",
                                ]}
                                onClear={() => onClearSection("CONNECTION", "Connection and link settings")}
                                disabled={isSaving}
                            />
                            <Button type="submit" disabled={isSaving}>
                                <Save className="mr-2 h-4 w-4" />
                                {isSaving ? "Saving..." : "Save Connection And Link Settings"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </form>

            <Card>
                <CardHeader>
                    <div className="flex items-start gap-3">
                        <SectionIcon icon={MailCheck} />
                        <div>
                            <CardTitle>Lead Email Detection</CardTitle>
                            <CardDescription>
                                Match old CRM notification emails in synced Outlook so lead handoff can be grouped and processed in Estio.
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmitLegacyCrmLeadEmail} className="space-y-5">
                        <input type="hidden" name="locationId" value={defaultValues.locationId} />
                        <input type="hidden" name="settingsVersion" value={String(defaultValues.settingsVersion)} />

                        <label className="flex items-start gap-3 rounded-md border p-4">
                            <input
                                id="legacyCrmLeadEmailEnabled"
                                name="legacyCrmLeadEmailEnabled"
                                type="checkbox"
                                defaultChecked={defaultValues.legacyCrmLeadEmailEnabled}
                                key={`legacy-enabled-${String(defaultValues.legacyCrmLeadEmailEnabled)}`}
                                className="mt-1 h-4 w-4"
                            />
                            <span className="space-y-1">
                                <span className="block text-sm font-medium">Enable old CRM lead email detection</span>
                                <span className="block text-xs leading-5 text-muted-foreground">
                                    Detection runs against synced Outlook emails. Auto-processing can remain off while the workflow is being tested.
                                </span>
                            </span>
                        </label>

                        <div className="grid gap-4 lg:grid-cols-3">
                            <div className="space-y-2">
                                <Label htmlFor="legacyCrmLeadEmailSenders">Sender Emails</Label>
                                <Textarea
                                    id="legacyCrmLeadEmailSenders"
                                    name="legacyCrmLeadEmailSenders"
                                    defaultValue={defaultValues.legacyCrmLeadEmailSenders}
                                    key={`legacy-senders-${defaultValues.legacyCrmLeadEmailSenders}`}
                                    placeholder={"info@downtowncyprus.com\ninfo=downtowncyprus.com@mg.downtowncyprus.com"}
                                    className="min-h-[112px] font-mono text-sm"
                                />
                                <FormHint>One exact sender per line.</FormHint>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="legacyCrmLeadEmailSenderDomains">Sender Domains</Label>
                                <Textarea
                                    id="legacyCrmLeadEmailSenderDomains"
                                    name="legacyCrmLeadEmailSenderDomains"
                                    defaultValue={defaultValues.legacyCrmLeadEmailSenderDomains}
                                    key={`legacy-domains-${defaultValues.legacyCrmLeadEmailSenderDomains}`}
                                    placeholder={"downtowncyprus.com\nmg.downtowncyprus.com"}
                                    className="min-h-[112px] font-mono text-sm"
                                />
                                <FormHint>Fallback domain matching for relay-style senders.</FormHint>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="legacyCrmLeadEmailSubjectPatterns">Subject Patterns</Label>
                                <Textarea
                                    id="legacyCrmLeadEmailSubjectPatterns"
                                    name="legacyCrmLeadEmailSubjectPatterns"
                                    defaultValue={defaultValues.legacyCrmLeadEmailSubjectPatterns}
                                    key={`legacy-subjects-${defaultValues.legacyCrmLeadEmailSubjectPatterns}`}
                                    placeholder={"You have been assigned a new lead!\nYou need to follow up on a lead!"}
                                    className="min-h-[112px] font-mono text-sm"
                                />
                                <FormHint>Case-insensitive contains match. One pattern per line.</FormHint>
                            </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                            <label className="flex items-start gap-2 rounded-md border p-3">
                                <input
                                    id="legacyCrmLeadEmailPinConversation"
                                    name="legacyCrmLeadEmailPinConversation"
                                    type="checkbox"
                                    defaultChecked={defaultValues.legacyCrmLeadEmailPinConversation}
                                    key={`legacy-pin-${String(defaultValues.legacyCrmLeadEmailPinConversation)}`}
                                    className="mt-1 h-4 w-4"
                                />
                                <span>
                                    <span className="block text-sm font-medium">Pin Notifier Thread</span>
                                    <span className="block text-xs text-muted-foreground">Keep the old CRM notifier conversation easy to find.</span>
                                </span>
                            </label>
                            <label className="flex items-start gap-2 rounded-md border p-3">
                                <input
                                    id="legacyCrmLeadEmailAutoProcess"
                                    name="legacyCrmLeadEmailAutoProcess"
                                    type="checkbox"
                                    defaultChecked={defaultValues.legacyCrmLeadEmailAutoProcess}
                                    key={`legacy-auto-${String(defaultValues.legacyCrmLeadEmailAutoProcess)}`}
                                    className="mt-1 h-4 w-4"
                                />
                                <span>
                                    <span className="block text-sm font-medium">Auto Process</span>
                                    <span className="block text-xs text-muted-foreground">Reserved for the next phase.</span>
                                </span>
                            </label>
                            <label className="flex items-start gap-2 rounded-md border p-3">
                                <input
                                    id="legacyCrmLeadEmailAutoDraftFirstContact"
                                    name="legacyCrmLeadEmailAutoDraftFirstContact"
                                    type="checkbox"
                                    defaultChecked={defaultValues.legacyCrmLeadEmailAutoDraftFirstContact}
                                    key={`legacy-draft-${String(defaultValues.legacyCrmLeadEmailAutoDraftFirstContact)}`}
                                    className="mt-1 h-4 w-4"
                                />
                                <span>
                                    <span className="block text-sm font-medium">Auto Draft First Contact</span>
                                    <span className="block text-xs text-muted-foreground">Draft-only. Does not auto-send.</span>
                                </span>
                            </label>
                        </div>

                        <div className="flex justify-end gap-2">
                            <ClearSettingsButton
                                title="Clear lead-email settings?"
                                items={[
                                    "Sender email and domain rules",
                                    "Subject matching patterns",
                                    "Pinning and automation options",
                                ]}
                                onClear={() => onClearSection("LEAD_EMAIL", "Lead-email settings")}
                                disabled={isSavingLegacyLeadEmail}
                            />
                            <Button type="submit" disabled={isSavingLegacyLeadEmail}>
                                <Save className="mr-2 h-4 w-4" />
                                {isSavingLegacyLeadEmail ? "Saving..." : "Save Lead Email Settings"}
                            </Button>
                        </div>
                    </form>
                </CardContent>
            </Card>

            <div className="grid gap-6 xl:grid-cols-2">
                <Card>
                    <CardHeader>
                        <div className="flex items-start gap-3">
                            <SectionIcon icon={Database} />
                            <div>
                                <CardTitle>Property Schema Tools</CardTitle>
                                <CardDescription>
                                    Analyze the old CRM create-property form before running imports.
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Button onClick={onAnalyze} disabled={isAnalyzing} variant="outline">
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {isAnalyzing ? "Working..." : "Analyze Property Schema"}
                        </Button>

                        {schema && (
                            <div className="space-y-4">
                                <div className="max-h-72 overflow-y-auto rounded-md bg-muted p-4 text-xs font-mono">
                                    <pre>{JSON.stringify(schema, null, 2)}</pre>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ClearSettingsButton
                                        title="Clear the property import schema?"
                                        items={["The saved Old CRM property-field schema"]}
                                        onClear={() => onClearSection("PROPERTY_SCHEMA", "Property schema")}
                                        disabled={isAnalyzing}
                                    />
                                    <Button
                                        onClick={async () => {
                                            setIsAnalyzing(true);
                                            try {
                                                const result = await saveCrmSchema(schema);
                                                if (result.success) {
                                                    toast.success("Schema saved successfully");
                                                } else {
                                                    toast.error("Failed to save schema");
                                                }
                                            } catch (e) {
                                                toast.error("Error saving schema");
                                            } finally {
                                                setIsAnalyzing(false);
                                            }
                                        }}
                                        variant="secondary"
                                        disabled={isAnalyzing}
                                    >
                                        <Save className="mr-2 h-4 w-4" />
                                        Save Property Schema
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex items-start gap-3">
                            <SectionIcon icon={FileSearch} />
                            <div>
                                <CardTitle>Lead Schema Tools</CardTitle>
                                <CardDescription>
                                    Analyze an old CRM lead page to discover fields available for synchronization.
                                </CardDescription>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="leadUrl">Test Lead URL</Label>
                            <Input
                                id="leadUrl"
                                placeholder="https://www.downtowncyprus.com/admin/leads/create"
                                value={leadAnalysisUrl}
                                onChange={(e) => setLeadAnalysisUrl(e.target.value)}
                            />
                        </div>

                        <Button onClick={onAnalyzeLead} disabled={isLeadAnalyzing} variant="outline">
                            <ExternalLink className="mr-2 h-4 w-4" />
                            {isLeadAnalyzing ? "Analyzing..." : "Analyze Lead Page"}
                        </Button>

                        {leadAnalysisResult && (
                            <div className="space-y-4">
                                <div className="max-h-96 overflow-y-auto rounded-md bg-muted p-4 text-xs font-mono">
                                    <pre>{JSON.stringify(leadAnalysisResult, null, 2)}</pre>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    <ClearSettingsButton
                                        title="Clear the lead import schema?"
                                        items={["The saved Old CRM lead-field schema"]}
                                        onClear={() => onClearSection("LEAD_SCHEMA", "Lead schema")}
                                        disabled={isLeadAnalyzing}
                                    />
                                    <Button
                                        onClick={async () => {
                                            setIsLeadAnalyzing(true);
                                            try {
                                                const result = await saveLeadSchema(leadAnalysisResult, defaultValues.locationId || null);
                                                if (result.success) {
                                                    toast.success("Lead schema saved successfully");
                                                    if (typeof result.version === "number") {
                                                        setDefaultValues((prev) => ({
                                                            ...prev,
                                                            settingsVersion: result.version,
                                                        }));
                                                    }
                                                } else {
                                                    toast.error("Failed to save lead schema: " + result.error);
                                                }
                                            } catch (e) {
                                                toast.error("Error saving lead schema");
                                            } finally {
                                                setIsLeadAnalyzing(false);
                                            }
                                        }}
                                        variant="secondary"
                                        disabled={isLeadAnalyzing}
                                    >
                                        <Save className="mr-2 h-4 w-4" />
                                        Save Lead Schema
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <LeadSourceManagerWrapper locationId={defaultValues.locationId} />
        </div>
    );
}

function LeadSourceManagerWrapper({ locationId }: { locationId: string }) {
    const [sources, setSources] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!locationId) {
            setLoading(false);
            return;
        }
        setLoading(true);
        getLeadSources(locationId).then((res) => {
            if (res.success && res.sources) {
                setSources(res.sources);
            }
            setLoading(false);
        });
    }, [locationId]);

    if (loading) {
        return (
            <Card>
                <CardContent className="p-6 text-sm text-muted-foreground">Loading lead sources...</CardContent>
            </Card>
        );
    }

    return <LeadSourceManager initialSources={sources} locationId={locationId} />;
}
