"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { saveCrmCredentials, getCrmSettings, analyzeLeadSchema, saveLeadSchema, saveLegacyCrmLeadEmailSettings } from "./actions";
import { analyzeCrmSchema, saveCrmSchema } from "../../properties/import/actions";
import { LeadSourceManager } from "./_components/lead-source-manager";

type CrmSettingsFormValues = {
    locationId: string;
    settingsVersion: number;
    crmUrl: string;
    crmUsername: string;
    crmPassword: string;
    hasCrmPassword: boolean;
    crmEditUrlPattern: string;
    crmLeadUrlPattern: string;
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
    crmUrl: "https://www.downtowncyprus.com/admin",
    crmUsername: "",
    crmPassword: "",
    hasCrmPassword: false,
    crmEditUrlPattern: "",
    crmLeadUrlPattern: "",
    legacyCrmLeadEmailEnabled: false,
    legacyCrmLeadEmailSenders: "info@downtowncyprus.com",
    legacyCrmLeadEmailSenderDomains: "mg.downtowncyprus.com",
    legacyCrmLeadEmailSubjectPatterns: "You have been assigned a new lead!\nYou need to follow up on a lead!",
    legacyCrmLeadEmailPinConversation: true,
    legacyCrmLeadEmailAutoProcess: false,
    legacyCrmLeadEmailAutoDraftFirstContact: false,
};

function listToTextareaValue(value: unknown, fallback: string) {
    return Array.isArray(value) ? value.join("\n") || fallback : fallback;
}

function normalizeCrmSettings(settings: any): CrmSettingsFormValues {
    return {
        locationId: settings.locationId || DEFAULT_CRM_SETTINGS.locationId,
        settingsVersion: Number(settings.settingsVersion || DEFAULT_CRM_SETTINGS.settingsVersion),
        crmUrl: settings.crmUrl || DEFAULT_CRM_SETTINGS.crmUrl,
        crmUsername: settings.crmUsername || DEFAULT_CRM_SETTINGS.crmUsername,
        crmPassword: "",
        hasCrmPassword: Boolean(settings.hasCrmPassword),
        crmEditUrlPattern: settings.crmEditUrlPattern || DEFAULT_CRM_SETTINGS.crmEditUrlPattern,
        crmLeadUrlPattern: settings.crmLeadUrlPattern || DEFAULT_CRM_SETTINGS.crmLeadUrlPattern,
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

export default function CrmSettingsPage() {
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
                    if (settings.crmSchema) {
                        setSchema(settings.crmSchema);
                    }
                    if (settings.crmLeadSchema) {
                        setLeadAnalysisResult(settings.crmLeadSchema);
                    }
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
            toast.success("Credentials saved successfully");
            await refreshSavedSettings({ updatePasswordState: true });
        } catch (error) {
            toast.error("Failed to save credentials");
            console.error(error);
        } finally {
            setIsSaving(false);
        }
    }

    return (
        <div className="p-6 max-w-2xl">
            <h1 className="text-2xl font-bold mb-6">CRM Integration Settings</h1>

            <Card>
                <CardHeader>
                    <CardTitle>Old CRM Credentials</CardTitle>
                    <CardDescription>
                        Enter the login details for downtowncyprus.com admin panel.
                        These will be used for automated property imports.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmit} className="space-y-4">
                        <input type="hidden" name="locationId" value={defaultValues.locationId} />
                        <input type="hidden" name="settingsVersion" value={String(defaultValues.settingsVersion)} />
                        <div className="space-y-2">
                            <Label htmlFor="crmUrl">CRM URL</Label>
                            <Input
                                id="crmUrl"
                                name="crmUrl"
                                defaultValue={defaultValues.crmUrl}
                                key={defaultValues.crmUrl} // Force re-render on default value change
                                placeholder="https://www.downtowncyprus.com/admin"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="crmEditUrlPattern">Edit URL Pattern (Optional)</Label>
                            <Input
                                id="crmEditUrlPattern"
                                name="crmEditUrlPattern"
                                defaultValue={defaultValues.crmEditUrlPattern}
                                key={`pattern-${defaultValues.crmEditUrlPattern}`}
                                placeholder="https://site.com/admin/properties/{id}/edit"
                            />
                            <p className="text-xs text-muted-foreground">
                                Use <code>{'{id}'}</code> as a placeholder for the property ID.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="crmLeadUrlPattern">Lead Edit URL Pattern (Optional)</Label>
                            <Input
                                id="crmLeadUrlPattern"
                                name="crmLeadUrlPattern"
                                defaultValue={defaultValues.crmLeadUrlPattern}
                                key={`pattern-lead-${defaultValues.crmLeadUrlPattern}`} // Force re-render
                                placeholder="https://site.com/admin/leads/{id}/edit"
                            />
                            <p className="text-xs text-muted-foreground">
                                Use <code>{'{id}'}</code> as a placeholder for the lead ID.
                                Defaults to <code>{`.../leads/{id}/edit`}</code>
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="crmUsername">Username</Label>
                            <Input
                                id="crmUsername"
                                name="crmUsername"
                                defaultValue={defaultValues.crmUsername}
                                key={`user-${defaultValues.crmUsername}`}
                                placeholder="admin"
                                required
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
                            <p className="text-xs text-muted-foreground">
                                {defaultValues.hasCrmPassword
                                    ? "Password is already configured. Leave blank to keep it."
                                    : "No password configured yet."}
                            </p>
                            <label className="flex items-center gap-2 text-sm">
                                <input
                                    type="checkbox"
                                    name="clearCrmPassword"
                                    className="h-4 w-4"
                                />
                                Clear stored password
                            </label>
                        </div>

                        <Button type="submit" disabled={isSaving}>
                            {isSaving ? "Saving..." : "Save Credentials"}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <Card className="mt-6">
                <CardHeader>
                    <CardTitle>Old CRM Lead Email Notifications (Outlook)</CardTitle>
                    <CardDescription>
                        Configure which incoming email sender/domain identifies old CRM lead notifications so they can be grouped and processed in Estio.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <form onSubmit={onSubmitLegacyCrmLeadEmail} className="space-y-4">
                        <input type="hidden" name="locationId" value={defaultValues.locationId} />
                        <input type="hidden" name="settingsVersion" value={String(defaultValues.settingsVersion)} />
                        <div className="rounded-md border p-4 space-y-3">
                            <div className="flex items-start gap-3">
                                <input
                                    id="legacyCrmLeadEmailEnabled"
                                    name="legacyCrmLeadEmailEnabled"
                                    type="checkbox"
                                    defaultChecked={defaultValues.legacyCrmLeadEmailEnabled}
                                    key={`legacy-enabled-${String(defaultValues.legacyCrmLeadEmailEnabled)}`}
                                    className="mt-1 h-4 w-4"
                                />
                                <div className="space-y-1">
                                    <Label htmlFor="legacyCrmLeadEmailEnabled">Enable legacy CRM lead email detection</Label>
                                    <p className="text-xs text-muted-foreground">
                                        Detect old CRM lead notifications in synced Outlook emails (manual processing action in phase 3, auto-processing optional).
                                    </p>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="legacyCrmLeadEmailSenders">Sender Email(s)</Label>
                            <Textarea
                                id="legacyCrmLeadEmailSenders"
                                name="legacyCrmLeadEmailSenders"
                                defaultValue={defaultValues.legacyCrmLeadEmailSenders}
                                key={`legacy-senders-${defaultValues.legacyCrmLeadEmailSenders}`}
                                placeholder={"info@downtowncyprus.com\ninfo=downtowncyprus.com@mg.downtowncyprus.com"}
                                className="min-h-[90px] font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                One sender per line. Exact address match is preferred (the actual visible From address in Outlook).
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="legacyCrmLeadEmailSenderDomains">Sender Domain(s) (Optional)</Label>
                            <Textarea
                                id="legacyCrmLeadEmailSenderDomains"
                                name="legacyCrmLeadEmailSenderDomains"
                                defaultValue={defaultValues.legacyCrmLeadEmailSenderDomains}
                                key={`legacy-domains-${defaultValues.legacyCrmLeadEmailSenderDomains}`}
                                placeholder={"downtowncyprus.com\nmg.downtowncyprus.com"}
                                className="min-h-[80px] font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Domain fallback match for Mailgun/relay patterns. Enter domains only (no @).
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="legacyCrmLeadEmailSubjectPatterns">Subject Pattern(s)</Label>
                            <Textarea
                                id="legacyCrmLeadEmailSubjectPatterns"
                                name="legacyCrmLeadEmailSubjectPatterns"
                                defaultValue={defaultValues.legacyCrmLeadEmailSubjectPatterns}
                                key={`legacy-subjects-${defaultValues.legacyCrmLeadEmailSubjectPatterns}`}
                                placeholder={"You have been assigned a new lead!\nYou need to follow up on a lead!"}
                                className="min-h-[90px] font-mono text-sm"
                            />
                            <p className="text-xs text-muted-foreground">
                                Case-insensitive contains match. One pattern per line.
                            </p>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                            <label className="flex items-start gap-2 rounded-md border p-3">
                                <input
                                    id="legacyCrmLeadEmailPinConversation"
                                    name="legacyCrmLeadEmailPinConversation"
                                    type="checkbox"
                                    defaultChecked={defaultValues.legacyCrmLeadEmailPinConversation}
                                    key={`legacy-pin-${String(defaultValues.legacyCrmLeadEmailPinConversation)}`}
                                    className="mt-1 h-4 w-4"
                                />
                                <div>
                                    <div className="text-sm font-medium">Pin Notifier Thread</div>
                                    <div className="text-xs text-muted-foreground">Keep the old CRM notifier conversation at the top (used by later phase).</div>
                                </div>
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
                                <div>
                                    <div className="text-sm font-medium">Auto Process</div>
                                    <div className="text-xs text-muted-foreground">Reserved for next phase. Manual processing is implemented first.</div>
                                </div>
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
                                <div>
                                    <div className="text-sm font-medium">Auto Draft First Contact</div>
                                    <div className="text-xs text-muted-foreground">Reserved for next phase (draft-only, no auto-send).</div>
                                </div>
                            </label>
                        </div>

                        <Button type="submit" disabled={isSavingLegacyLeadEmail}>
                            {isSavingLegacyLeadEmail ? "Saving..." : "Save Lead Email Notification Settings"}
                        </Button>
                    </form>
                </CardContent>
            </Card>

            <Card className="mt-6">
                <CardHeader>
                    <CardTitle>CRM Schema Configuration</CardTitle>
                    <CardDescription>
                        Analyze the "Create Property" form in the old CRM to understand the data structure.
                        This is required before you can run imports.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Button onClick={onAnalyze} disabled={isAnalyzing}>
                        {isAnalyzing ? "Working..." : "Analyze Schema"}
                    </Button>

                    {schema && (
                        <div className="mt-4 space-y-4">
                            <div className="p-4 bg-muted rounded-md max-h-60 overflow-y-auto text-xs font-mono">
                                <pre>{JSON.stringify(schema, null, 2)}</pre>
                            </div>
                            <Button
                                onClick={async () => {
                                    setIsAnalyzing(true);
                                    try {
                                        const result = await saveCrmSchema(schema);
                                        if (result.success) {
                                            toast.success("Schema saved successfully!");
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
                                Save Schema to Database
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card className="mt-6">
                <CardHeader>
                    <CardTitle>Lead Schema Analysis (Beta)</CardTitle>
                    <CardDescription>
                        Analyze a specific "Edit Lead" page to discover available fields for synchronization.
                    </CardDescription>
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

                    <Button onClick={onAnalyzeLead} disabled={isLeadAnalyzing}>
                        {isLeadAnalyzing ? "Analyzing..." : "Analyze Lead Page"}
                    </Button>

                    {leadAnalysisResult && (
                        <div className="mt-4 space-y-4">
                            <div className="p-4 bg-muted rounded-md max-h-96 overflow-y-auto text-xs font-mono">
                                <pre>{JSON.stringify(leadAnalysisResult, null, 2)}</pre>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Review the fields above. This data will be used to map the "Pull from CRM" logic.
                            </p>
                            <Button
                                onClick={async () => {
                                    setIsLeadAnalyzing(true);
                                    try {
                                        const result = await saveLeadSchema(leadAnalysisResult, defaultValues.locationId || null);
                                        if (result.success) {
                                            toast.success("Lead schema saved successfully!");
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
                                Save Lead Schema to Database
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Lead Sources Manager */}
            <div className="mt-6">
                <LeadSourceManagerWrapper locationId={defaultValues.locationId} />
            </div>
        </div >
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
        // We need an action to fetch sources
        import('./actions').then(({ getLeadSources }) => {
            getLeadSources(locationId).then((res) => {
                if (res.success && res.sources) {
                    setSources(res.sources);
                }
                setLoading(false);
            });
        });
    }, [locationId]);

    if (loading) return <div>Loading Lead Sources...</div>;

    return <LeadSourceManager initialSources={sources} locationId={locationId} />;
}
