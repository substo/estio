"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { saveCrmCredentials, getCrmSettings, analyzeLeadSchema, saveLeadSchema } from "./actions";
import { analyzeCrmSchema, saveCrmSchema } from "../../properties/import/actions";
import { useEffect } from "react";
import { LeadSourceManager } from "./_components/lead-source-manager";


export default function CrmSettingsPage() {
    const [isSaving, setIsSaving] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isLeadAnalyzing, setIsLeadAnalyzing] = useState(false);
    const [schema, setSchema] = useState<any>(null);
    const [defaultValues, setDefaultValues] = useState({
        crmUrl: "https://www.downtowncyprus.com/admin",
        crmUsername: "",
        crmPassword: "",
        crmEditUrlPattern: "",
        crmLeadUrlPattern: ""
    });
    const [leadAnalysisUrl, setLeadAnalysisUrl] = useState("https://www.downtowncyprus.com/admin/leads/create");
    const [leadAnalysisResult, setLeadAnalysisResult] = useState<any>(null);

    useEffect(() => {
        async function fetchSettings() {
            try {
                const settings = await getCrmSettings();
                if (settings) {
                    setDefaultValues({
                        crmUrl: settings.crmUrl || "https://www.downtowncyprus.com/admin",
                        crmUsername: settings.crmUsername || "",
                        crmPassword: settings.crmPassword || "",
                        crmEditUrlPattern: settings.crmEditUrlPattern || "",
                        crmLeadUrlPattern: settings.crmLeadUrlPattern || ""
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
