"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { saveCrmCredentials, getCrmSettings, analyzeLeadSchema, saveLeadSchema, saveLegacyCrmLeadEmailSettings } from "./actions";
import { analyzeCrmSchema, saveCrmSchema } from "../../properties/import/actions";
import { useEffect } from "react";
import { LeadSourceManager } from "./_components/lead-source-manager";


export default function CrmSettingsPage() {
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingLegacyLeadEmail, setIsSavingLegacyLeadEmail] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isLeadAnalyzing, setIsLeadAnalyzing] = useState(false);
    const [schema, setSchema] = useState<any>(null);
    const [defaultValues, setDefaultValues] = useState({
        crmUrl: "https://www.downtowncyprus.com/admin",
        crmUsername: "",
        crmPassword: "",
        crmEditUrlPattern: "",
        crmLeadUrlPattern: "",
        legacyCrmLeadEmailEnabled: false,
        legacyCrmLeadEmailSenders: "info@downtowncyprus.com",
        legacyCrmLeadEmailSenderDomains: "mg.downtowncyprus.com",
        legacyCrmLeadEmailSubjectPatterns: "You have been assigned a new lead!\nYou need to follow up on a lead!",
        legacyCrmLeadEmailPinConversation: true,
        legacyCrmLeadEmailAutoProcess: false,
        legacyCrmLeadEmailAutoDraftFirstContact: false,
    });
    const [leadAnalysisUrl, setLeadAnalysisUrl] = useState("https://www.downtowncyprus.com/admin/leads/create");
    const [leadAnalysisResult, setLeadAnalysisResult] = useState<any>(null);

    useEffect(() => {
        async function fetchSettings() {
            try {
                const settings: any = await getCrmSettings();
                if (settings) {
                    setDefaultValues({
                        crmUrl: settings.crmUrl || "https://www.downtowncyprus.com/admin",
                        crmUsername: settings.crmUsername || "",
                        crmPassword: settings.crmPassword || "",
                        crmEditUrlPattern: settings.crmEditUrlPattern || "",
                        crmLeadUrlPattern: settings.crmLeadUrlPattern || "",
                        legacyCrmLeadEmailEnabled: !!settings.legacyCrmLeadEmailEnabled,
                        legacyCrmLeadEmailSenders: (settings.legacyCrmLeadEmailSenders || []).join("\n") || "info@downtowncyprus.com",
                        legacyCrmLeadEmailSenderDomains: (settings.legacyCrmLeadEmailSenderDomains || []).join("\n") || "mg.downtowncyprus.com",
                        legacyCrmLeadEmailSubjectPatterns: (settings.legacyCrmLeadEmailSubjectPatterns || []).join("\n") || "You have been assigned a new lead!\nYou need to follow up on a lead!",
                        legacyCrmLeadEmailPinConversation: settings.legacyCrmLeadEmailPinConversation ?? true,
                        legacyCrmLeadEmailAutoProcess: !!settings.legacyCrmLeadEmailAutoProcess,
                        legacyCrmLeadEmailAutoDraftFirstContact: !!settings.legacyCrmLeadEmailAutoDraftFirstContact,
                    });
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
        console.log("Analyze Lead button clicked");
        if (!leadAnalysisUrl) {
            console.log("No URL provided");
            toast.error("Please enter a URL");
            return;
        }
        setIsLeadAnalyzing(true);
        try {
            console.log("Calling server action analyzeLeadSchema with:", leadAnalysisUrl);
            const result = await analyzeLeadSchema(leadAnalysisUrl);
            console.log("Server action result:", result);
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
            await saveCrmCredentials(data);
            toast.success("Credentials saved successfully");
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
                                required
                            />
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
                                        const result = await saveLeadSchema(leadAnalysisResult);
                                        if (result.success) {
                                            toast.success("Lead schema saved successfully!");
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
                {/* 
                   Ideally we fetch this data server-side. Since this is a client component, we have a few options:
                   1. Convert this page to Server Component (it has 'use client' at top).
                   2. Fetch inside useEffect.
                   3. Create a wrapper Server Component.
                   
                   Current page is 'use client'. To minimize refactor, I will fetch inside useEffect or component wrapper?
                   Actually, let's keep it simple. I can add a small server component wrapper inside the layout or just fetch here via action.
                   BUT to be clean, let's make a separate wrapper or just fetch via action in useEffect for now since page is client.
                   Wait, I can't put server code (db.findMany) directly here if it's 'use client'. 
                   
                   Better approach: Create a Server Component wrapper that fetches data and passes it to the Client Component.
                   OR: Use a server action to fetch string list.

                   Let's use a server action `getLeadSources` in `./actions.ts`.
                 */}
                {/* Re-evaluating: convert page to server component? It has a lot of state. 
                    Let's just fetch via action for now to avoid big refactor.
                 */}
                <LeadSourceManagerWrapper />
            </div>
        </div >
    );
}

function LeadSourceManagerWrapper() {
    const [sources, setSources] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // We need an action to fetch sources
        import('./actions').then(({ getLeadSources }) => {
            getLeadSources().then((res) => {
                if (res.success && res.sources) {
                    setSources(res.sources);
                }
                setLoading(false);
            });
        });
    }, []);

    if (loading) return <div>Loading Lead Sources...</div>;

    return <LeadSourceManager initialSources={sources} />;
}
