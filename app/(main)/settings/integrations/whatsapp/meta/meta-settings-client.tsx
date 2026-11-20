"use client";

import { useState, useEffect } from "react";
import {
    getWhatsAppSettings,
    updateWhatsAppSettings,
    exchangeSystemUserToken,
    getWhatsAppCloudHealth,
    syncWhatsAppTemplates,
    listWhatsAppTemplates,
    repairWhatsAppCloudConnection,
    saveWhatsAppTemplateDraft,
    submitWhatsAppTemplateDraft,
    generateWhatsAppTemplateDrafts,
    setDefaultWhatsAppChannelAction,
    verifyWhatsAppCloudChannel,
    updateWhatsAppCallingSettings,
    checkWhatsAppCallingReadinessAction,
} from "../actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Copy, Check, Facebook, CheckCircle2, XCircle, AlertCircle, ChevronDown, Settings, RefreshCw, AlertTriangle, Sparkles, Send, Save, Wand2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { FacebookSDKScript } from "@/components/integrations/facebook-sdk-script";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { WhatsAppNav } from "../whatsapp-nav";

type WhatsAppChannelRow = {
    id: string;
    wabaId: string;
    phoneNumberId: string;
    displayPhoneNumber: string;
    verifiedName: string;
    providerMode: string;
    status: string;
    qualityRating: string;
    platformType: string;
    isDefaultOutbound: boolean;
    coexistenceEnabled: boolean;
    lastHealthCheckedAt: string | null;
};

type WhatsAppWebBridgeSessionRow = {
    id: string;
    sessionId: string;
    phone: string;
    status: string;
    qrCode: string;
    lastReadyAt: string | null;
    lastSeenAt: string | null;
    lastError: string;
    isDefaultOutbound: boolean;
};

type WhatsAppWebBridgeDiagnostics = {
    reachable: boolean;
    ok: boolean;
    severity: "healthy" | "warning" | "error";
    status: "healthy" | "worker_unreachable" | "stale_worker" | "qr_required" | "unlinked" | "starting" | "failed" | "disconnected";
    message: string;
    baseUrl: string;
    uptimeSeconds: number | null;
    sessionCount: number | null;
    sessionDir: string | null;
    expectedSessionDir: string | null;
    sessionDirMatchesExpected: boolean | null;
    maxInlineMediaBytes: number | null;
    protocolTimeoutMs: number | null;
    dbStatus: string;
    workerStatus: string | null;
    workerSessionPresent: boolean;
    workerReady: boolean;
    stale: boolean;
    workerLastEventAt: string | null;
    workerLastReadyAt: string | null;
    workerLastError: string | null;
    error: string | null;
};

type WhatsAppCallingConfigState = {
    provider: string;
    status: string;
    phoneNumberId: string;
    wabaId: string;
    callingEnabled: boolean;
    webhooksEnabled: boolean;
    mediaMode: string;
    sipEndpoint: string;
    mediaNotes: string;
    lastReadinessStatus: string | null;
    lastReadinessCheckedAt: string | null;
    lastError: string;
    metadata: Record<string, any>;
};

const EMPTY_CALLING_CONFIG: WhatsAppCallingConfigState = {
    provider: "meta_calling_api",
    status: "not_configured",
    phoneNumberId: "",
    wabaId: "",
    callingEnabled: false,
    webhooksEnabled: false,
    mediaMode: "sip",
    sipEndpoint: "",
    mediaNotes: "",
    lastReadinessStatus: null,
    lastReadinessCheckedAt: null,
    lastError: "",
    metadata: {},
};

type TemplateBuilderState = {
    id: string | null;
    name: string;
    language: string;
    category: string;
    headerText: string;
    bodyText: string;
    footerText: string;
    variableLabels: Record<string, string>;
    examples: Record<string, string>;
    aiPrompt: string;
    aiRiskNotes: any[];
};

const EMPTY_TEMPLATE: TemplateBuilderState = {
    id: null,
    name: "",
    language: "en_US",
    category: "UTILITY",
    headerText: "",
    bodyText: "",
    footerText: "",
    variableLabels: {},
    examples: {},
    aiPrompt: "",
    aiRiskNotes: [],
};

const TEMPLATE_INTENTS = [
    "first contact",
    "viewing reminder",
    "property follow-up",
    "owner update",
    "document request",
    "feedback request",
    "reactivation",
    "marketing/newsletter",
];

function normalizeTemplateNameInput(value: string) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

function extractVariables(text: string) {
    return Array.from(new Set(Array.from(String(text || "").matchAll(/\{\{\s*(\d+)\s*\}\}/g)).map((match) => match[1]))).sort((a, b) => Number(a) - Number(b));
}

function validateTemplateDraft(template: TemplateBuilderState) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const name = normalizeTemplateNameInput(template.name);
    const variables = extractVariables(template.bodyText);
    if (!name) errors.push("Template name is required.");
    if (!template.bodyText.trim()) errors.push("Body text is required.");
    if (template.bodyText.length > 1024) errors.push("Body must be 1024 characters or less.");
    if (template.headerText.length > 60) errors.push("Header text must be 60 characters or less.");
    if (template.footerText.length > 60) errors.push("Footer text must be 60 characters or less.");
    variables.forEach((variable, index) => {
        if (variable !== String(index + 1)) errors.push("Variables must be sequential, starting at {{1}}.");
        if (!String(template.examples[variable] || "").trim()) errors.push(`Sample value is required for {{${variable}}}.`);
    });
    const lowerBody = template.bodyText.toLowerCase();
    if (template.category === "UTILITY" && ["discount", "offer", "sale", "newsletter", "promotion", "new listing"].some((word) => lowerBody.includes(word))) {
        warnings.push("This may be Marketing rather than Utility.");
    }
    if (template.category === "MARKETING" && !template.footerText.toLowerCase().includes("stop")) {
        warnings.push("Marketing templates should usually include an opt-out footer.");
    }
    return { errors: Array.from(new Set(errors)), warnings: Array.from(new Set(warnings)), variables };
}

function renderPreview(text: string, examples: Record<string, string>) {
    return String(text || "").replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, index) => examples[index] || `{{${index}}}`);
}

function formatBridgeUptime(seconds: number | null | undefined) {
    const total = Math.max(0, Number(seconds || 0));
    if (!Number.isFinite(total) || total <= 0) return "Unknown";
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${Math.max(1, minutes)}m`;
}

function formatBridgeBytes(bytes: number | null | undefined) {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) return "Unknown";
    return `${Math.round(value / 1024 / 1024)} MB`;
}

export default function MetaSettingsClient() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [settings, setSettings] = useState({
        businessAccountId: "",
        phoneNumberId: "",
        accessToken: "",
        hasAccessToken: false,
        webhookSecret: "",
        locationId: "",
        // Twilio
        twilioAccountSid: "",
        twilioAuthToken: "",
        hasTwilioAuthToken: false,
        twilioWhatsAppFrom: "",
        whatsappProviderMode: "web_bridge",
        whatsappChannels: [] as WhatsAppChannelRow[],
        whatsappCallingConfig: EMPTY_CALLING_CONFIG,
        webBridgeSession: null as WhatsAppWebBridgeSessionRow | null,
        webBridgeDiagnostics: null as WhatsAppWebBridgeDiagnostics | null,
    });
    const [cloudHealth, setCloudHealth] = useState<any>(null);
    const [cloudBusy, setCloudBusy] = useState(false);
    const [templates, setTemplates] = useState<any[]>([]);
    const [templateFilter, setTemplateFilter] = useState("all");
    const [templateBuilder, setTemplateBuilder] = useState<TemplateBuilderState>(EMPTY_TEMPLATE);
    const [aiTemplateIntent, setAiTemplateIntent] = useState("first contact");
    const [aiTemplateNotes, setAiTemplateNotes] = useState("");
    const [aiVariants, setAiVariants] = useState<any[]>([]);
    const [aiBusy, setAiBusy] = useState(false);
    const [clearWhatsAppAccessToken, setClearWhatsAppAccessToken] = useState(false);
    const [clearTwilioAuthToken, setClearTwilioAuthToken] = useState(false);
    const [callingBusy, setCallingBusy] = useState(false);
    const [callingReadiness, setCallingReadiness] = useState<any>(null);
    const selectedCallingChannel = settings.whatsappChannels.find((channel) => channel.phoneNumberId === settings.whatsappCallingConfig.phoneNumberId)
        || settings.whatsappChannels.find((channel) => channel.isDefaultOutbound)
        || settings.whatsappChannels[0]
        || null;

    // Embedded Signup State
    const [appId, setAppId] = useState(process.env.NEXT_PUBLIC_META_APP_ID || "");
    const [configId, setConfigId] = useState(process.env.NEXT_PUBLIC_META_CONFIG_ID || "");
    const [fbSdkReady, setFbSdkReady] = useState(false);

    // Cross-Domain Bridge State
    const [useBridge, setUseBridge] = useState(false);

    const { toast } = useToast();
    const [copied, setCopied] = useState(false);

    // Connection status for visible feedback
    const [connectionStatus, setConnectionStatus] = useState<{
        type: 'idle' | 'success' | 'error';
        message: string;
    }>({ type: 'idle', message: '' });

    // Manual config toggle
    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        // Detect if we are on a "Safe" domain (allow-listed in Meta)
        const hostname = window.location.hostname;
        const isSafe =
            hostname === "localhost" ||
            hostname === "estio.co" ||
            hostname.endsWith(".ngrok-free.app");

        setUseBridge(!isSafe);
    }, []);

    const applyServerSettings = (data: any) => {
        setSettings({
            businessAccountId: data.businessAccountId || "",
            phoneNumberId: data.phoneNumberId || "",
            accessToken: data.accessToken || "",
            hasAccessToken: Boolean(data.hasAccessToken),
            webhookSecret: data.webhookSecret || crypto.randomUUID(),
            locationId: data.locationId || "",
            twilioAccountSid: data.twilioAccountSid || "",
            twilioAuthToken: data.twilioAuthToken || "",
            hasTwilioAuthToken: Boolean(data.hasTwilioAuthToken),
            twilioWhatsAppFrom: data.twilioWhatsAppFrom || "",
            whatsappProviderMode: data.whatsappProviderMode || "web_bridge",
            whatsappChannels: Array.isArray(data.whatsappChannels) ? data.whatsappChannels : [],
            whatsappCallingConfig: {
                ...EMPTY_CALLING_CONFIG,
                ...(data.whatsappCallingConfig || {}),
            },
            webBridgeSession: data.webBridgeSession || null,
            webBridgeDiagnostics: data.webBridgeDiagnostics || null,
        });
    };

    const refreshCloudOps = async (syncTemplates = false) => {
        setCloudBusy(true);
        try {
            const health = await getWhatsAppCloudHealth(settings.locationId || null);
            setCloudHealth(health);
            if (syncTemplates) {
                const result = await syncWhatsAppTemplates(settings.locationId || null);
                if (result?.success) setTemplates(result.templates || []);
            }
        } catch (error: any) {
            toast({ title: "Cloud API check failed", description: error?.message || "Unable to check Cloud API.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleRepairCloud = async () => {
        setCloudBusy(true);
        try {
            const result = await repairWhatsAppCloudConnection(settings.locationId || null);
            setCloudHealth(result.health);
            if (Array.isArray((result as any).channels)) {
                setSettings(prev => ({ ...prev, whatsappChannels: (result as any).channels }));
            }
            if ((result.templateResult as any)?.templates) setTemplates((result.templateResult as any).templates);
            toast({
                title: result.success ? "Cloud API verified" : "Cloud API needs attention",
                description: result.success ? "Webhook and template checks completed." : "Some checks are still failing.",
                variant: result.success ? "default" : "destructive",
            });
        } catch (error: any) {
            toast({ title: "Repair failed", description: error?.message || "Unable to repair Cloud API connection.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleVerifyChannel = async (channelId: string) => {
        setCloudBusy(true);
        try {
            const result = await verifyWhatsAppCloudChannel(channelId, settings.locationId || null);
            setCloudHealth(result.health);
            if (Array.isArray(result.channels)) {
                setSettings(prev => ({ ...prev, whatsappChannels: result.channels }));
            }
            toast({
                title: result.success ? "Number verified" : "Number needs attention",
                description: result.success ? "Meta returned healthy number details." : "Some Meta checks are still failing.",
                variant: result.success ? "default" : "destructive",
            });
        } catch (error: any) {
            toast({ title: "Verification failed", description: error?.message || "Unable to verify number.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleSetDefaultChannel = async (channelId: string) => {
        setCloudBusy(true);
        try {
            const result = await setDefaultWhatsAppChannelAction(channelId, settings.locationId || null);
            if (Array.isArray(result.channels)) {
                const nextDefault = result.channels.find((channel: WhatsAppChannelRow) => channel.isDefaultOutbound);
                setSettings(prev => ({
                    ...prev,
                    whatsappChannels: result.channels,
                    phoneNumberId: nextDefault?.phoneNumberId || prev.phoneNumberId,
                    businessAccountId: nextDefault?.wabaId || prev.businessAccountId,
                }));
            }
            toast({ title: "Default number updated", description: "New Cloud API sends will use this number." });
        } catch (error: any) {
            toast({ title: "Could not update default", description: error?.message || "Unable to set default number.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const reloadSettings = async () => {
        const data = await getWhatsAppSettings(settings.locationId || null);
        applyServerSettings(data);
    };

    const setCallingConfig = (patch: Partial<WhatsAppCallingConfigState>) => {
        setSettings(prev => ({
            ...prev,
            whatsappCallingConfig: {
                ...prev.whatsappCallingConfig,
                ...patch,
            },
        }));
    };

    const handleSaveCallingConfig = async () => {
        setCallingBusy(true);
        try {
            const result = await updateWhatsAppCallingSettings({
                locationId: settings.locationId || null,
                phoneNumberId: settings.whatsappCallingConfig.phoneNumberId || selectedCallingChannel?.phoneNumberId || null,
                wabaId: settings.whatsappCallingConfig.wabaId || selectedCallingChannel?.wabaId || null,
                callingEnabled: settings.whatsappCallingConfig.callingEnabled,
                webhooksEnabled: settings.whatsappCallingConfig.webhooksEnabled,
                mediaMode: settings.whatsappCallingConfig.mediaMode,
                sipEndpoint: settings.whatsappCallingConfig.sipEndpoint,
                mediaNotes: settings.whatsappCallingConfig.mediaNotes,
            });
            if (result?.success) {
                setCallingReadiness(result.readiness || null);
                setCallingConfig(result.config || EMPTY_CALLING_CONFIG);
                toast({ title: "Calling config saved", description: result.readiness?.errorMessage || "Readiness updated." });
            }
        } catch (error: any) {
            toast({ title: "Calling config failed", description: error?.message || "Unable to save calling config.", variant: "destructive" });
        } finally {
            setCallingBusy(false);
        }
    };

    const handleCheckCallingReadiness = async () => {
        setCallingBusy(true);
        try {
            const result = await checkWhatsAppCallingReadinessAction(settings.locationId || null);
            if (result?.success) {
                setCallingReadiness(result.readiness || null);
                setCallingConfig(result.config || EMPTY_CALLING_CONFIG);
                toast({
                    title: result.readiness?.ready ? "Calling ready" : "Calling not ready",
                    description: result.readiness?.errorMessage || "Readiness check complete.",
                    variant: result.readiness?.ready ? "default" : "destructive",
                });
            }
        } catch (error: any) {
            toast({ title: "Readiness check failed", description: error?.message || "Unable to check readiness.", variant: "destructive" });
        } finally {
            setCallingBusy(false);
        }
    };

    const loadTemplates = async (locationId = settings.locationId || null) => {
        const result = await listWhatsAppTemplates(locationId);
        if (result?.success) setTemplates(result.templates || []);
    };

    const applyTemplateToBuilder = (template: any) => {
        setTemplateBuilder({
            id: template.id || null,
            name: template.name || "",
            language: template.language || "en_US",
            category: template.category || "UTILITY",
            headerText: template.header?.text || template.headerText || "",
            bodyText: template.bodyText || "",
            footerText: template.footer || template.footerText || "",
            variableLabels: template.variableLabels || {},
            examples: template.examples || {},
            aiPrompt: template.aiPrompt || "",
            aiRiskNotes: template.aiRiskNotes || template.riskNotes || [],
        });
    };

    const handleSaveTemplateDraft = async () => {
        const validation = validateTemplateDraft(templateBuilder);
        if (!templateBuilder.name.trim() || !templateBuilder.bodyText.trim()) {
            toast({ title: "Template incomplete", description: "Name and body are required.", variant: "destructive" });
            return;
        }
        setCloudBusy(true);
        try {
            const result = await saveWhatsAppTemplateDraft({
                locationId: settings.locationId || null,
                templateId: templateBuilder.id,
                name: templateBuilder.name,
                language: templateBuilder.language,
                category: templateBuilder.category,
                headerText: templateBuilder.headerText,
                bodyText: templateBuilder.bodyText,
                footerText: templateBuilder.footerText,
                variableLabels: templateBuilder.variableLabels,
                examples: templateBuilder.examples,
                aiPrompt: templateBuilder.aiPrompt,
                aiRiskNotes: templateBuilder.aiRiskNotes,
            });
            await loadTemplates();
            if (result.template) applyTemplateToBuilder(result.template);
            toast({
                title: validation.errors.length ? "Draft saved" : "Template ready",
                description: validation.errors.length ? "Fix validation items before submitting to Meta." : "Human review can now submit this to Meta.",
            });
        } catch (error: any) {
            toast({ title: "Draft failed", description: error?.message || "Unable to save template.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleSubmitTemplate = async () => {
        const validation = validateTemplateDraft(templateBuilder);
        if (validation.errors.length) {
            toast({ title: "Template not ready", description: validation.errors[0], variant: "destructive" });
            return;
        }
        setCloudBusy(true);
        try {
            await submitWhatsAppTemplateDraft({
                locationId: settings.locationId || null,
                templateId: templateBuilder.id,
                name: templateBuilder.name,
                language: templateBuilder.language,
                category: templateBuilder.category,
                headerText: templateBuilder.headerText,
                bodyText: templateBuilder.bodyText,
                footerText: templateBuilder.footerText,
                variableLabels: templateBuilder.variableLabels,
                examples: templateBuilder.examples,
            });
            const result = await syncWhatsAppTemplates(settings.locationId || null);
            if (result?.success) setTemplates(result.templates || []);
            toast({ title: "Template submitted", description: "Meta will review the template before agents can send it." });
        } catch (error: any) {
            toast({ title: "Submission failed", description: error?.message || "Unable to submit template.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleGenerateTemplateVariants = async () => {
        setAiBusy(true);
        try {
            const result = await generateWhatsAppTemplateDrafts({
                locationId: settings.locationId || null,
                intent: aiTemplateIntent,
                notes: aiTemplateNotes,
                language: templateBuilder.language,
            });
            setAiVariants(result.variants || []);
            toast({ title: "AI variants ready", description: "Choose one, edit it, then save or submit after review." });
        } catch (error: any) {
            toast({ title: "AI generation failed", description: error?.message || "Unable to generate templates.", variant: "destructive" });
        } finally {
            setAiBusy(false);
        }
    };

    const handleLogin = async (response: any) => {
        // ... (rest of handleLogin implementation is unchanged)
        setSaving(true);
        setConnectionStatus({ type: 'idle', message: '' });
        console.log("Facebook Login Response:", response);

        // Check for either code (SUAT flow) or accessToken (User token flow)
        const code = response.authResponse?.code || response.code;
        const accessToken = response.authResponse?.accessToken;
        const selectedPhoneNumberId =
            response.authResponse?.phone_number_id ||
            response.authResponse?.phoneNumberId ||
            response.phone_number_id ||
            response.phoneNumberId ||
            null;

        if (code) {
            // System User Access Token flow - exchange code for token
            try {
                const result = await exchangeSystemUserToken(code, appId, undefined, false, settings.locationId || null, selectedPhoneNumberId);

                if (result.success) {
                    setConnectionStatus({ type: 'success', message: result.message });
                    toast({ title: "Success", description: result.message });
                    const data = await getWhatsAppSettings(settings.locationId || null);
                    if (data) applyServerSettings(data);
                } else {
                    setConnectionStatus({ type: 'error', message: result.message });
                    toast({ title: "Setup Failed", description: result.message, variant: "destructive" });
                }
            } catch (err: any) {
                console.error(err);
                const errorMsg = err?.message || "Failed to exchange token";
                setConnectionStatus({ type: 'error', message: errorMsg });
                toast({ title: "Error", description: errorMsg, variant: "destructive" });
            }
        } else if (accessToken) {
            // User Access Token flow - use token directly to fetch WABA info
            try {
                const result = await exchangeSystemUserToken(accessToken, appId, undefined, true, settings.locationId || null, selectedPhoneNumberId);

                if (result.success) {
                    setConnectionStatus({ type: 'success', message: result.message });
                    toast({ title: "Success", description: result.message });
                    const data = await getWhatsAppSettings(settings.locationId || null);
                    if (data) applyServerSettings(data);
                } else {
                    setConnectionStatus({ type: 'error', message: result.message });
                    toast({ title: "Setup Failed", description: result.message, variant: "destructive" });
                }
            } catch (err: any) {
                console.error(err);
                const errorMsg = err?.message || "Failed to save token";
                setConnectionStatus({ type: 'error', message: errorMsg });
                toast({ title: "Error", description: errorMsg, variant: "destructive" });
            }
        } else {
            setConnectionStatus({ type: 'error', message: "No auth response from Facebook. Please try again." });
            toast({ title: "Error", description: "No auth response from Facebook", variant: "destructive" });
        }
        setSaving(false);
    };

    useEffect(() => {
        // Listen for messages from the bridge
        const handleMessage = (event: MessageEvent) => {
            if (event.data?.type === "WHATSAPP_SESSION") {
                // Trust the message if it has the expected shape
                // The payload from bridge is the authResponse object
                handleLogin({ authResponse: event.data.payload });
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);


    useEffect(() => {
        getWhatsAppSettings(null).then((data) => {
            if (data) {
                applyServerSettings(data);
                listWhatsAppTemplates(data.locationId || null).then((result) => {
                    if (result?.success) setTemplates(result.templates || []);
                }).catch(() => undefined);
            }
            setLoading(false);
        });
    }, []);

    useEffect(() => {
        if (!settings.locationId || !settings.phoneNumberId) return;
        refreshCloudOps(false);
    }, [settings.locationId, settings.phoneNumberId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSaving(true);
        const formData = new FormData();
        formData.append("locationId", settings.locationId);
        formData.append("businessAccountId", settings.businessAccountId);
        formData.append("phoneNumberId", settings.phoneNumberId);
        formData.append("accessToken", settings.accessToken);
        formData.append("clearWhatsAppAccessToken", clearWhatsAppAccessToken ? "on" : "off");
        formData.append("webhookSecret", settings.webhookSecret);
        // Preserve the configured transport. Opening or saving Meta settings must not switch providers.
        formData.append("whatsappProviderMode", settings.whatsappProviderMode);

        // Twilio
        formData.append("twilioAccountSid", settings.twilioAccountSid);
        formData.append("twilioAuthToken", settings.twilioAuthToken);
        formData.append("clearTwilioAuthToken", clearTwilioAuthToken ? "on" : "off");
        formData.append("twilioWhatsAppFrom", settings.twilioWhatsAppFrom);

        try {
            const result = await updateWhatsAppSettings(formData);
            if (result.success) {
                toast({ title: "Settings saved", description: "WhatsApp configuration updated successfully." });
                const data = await getWhatsAppSettings(settings.locationId || null);
                if (data) applyServerSettings(data);
                setClearTwilioAuthToken(false);
                setClearWhatsAppAccessToken(false);
            } else {
                toast({ title: "Error", description: (result as any).error || "Failed to save settings.", variant: "destructive" });
            }
        } catch (error) {
            toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
        } finally {
            setSaving(false);
        }
    };

    const launchFacebookLogin = () => {
        if (useBridge) {
            // Open Bridge Popup
            const width = 600;
            const height = 700;
            const left = window.screen.width / 2 - width / 2;
            const top = window.screen.height / 2 - height / 2;
            const bridgeUrl = `https://estio.co/whatsapp-bridge?origin=${encodeURIComponent(window.location.origin)}`;

            window.open(bridgeUrl, "WhatsAppBridge", `width=${width},height=${height},left=${left},top=${top}`);
            return;
        }

        if (!fbSdkReady || !window.FB) {
            toast({
                title: "Error",
                description: "Facebook SDK not ready yet. Please refresh.",
                variant: "destructive",
            });
            return;
        }

        const configIdToUse = configId || process.env.NEXT_PUBLIC_META_CONFIG_ID;

        // @ts-ignore
        window.FB.login(
            function (response: any) {
                if (response.authResponse) {
                    handleLogin(response);
                } else {
                    console.log("User cancelled login or did not fully authorize.");
                }
            },
            {
                config_id: configIdToUse,
                // For User access token config, let FB return token directly
                // For SUAT config, use response_type: 'code'
                extras: {
                    setup: {}
                }
            }
        );
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast({ title: "Copied", description: "Copied to clipboard." });
    };

    if (loading) {
        return <div className="flex h-96 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
    }

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const webhookUrl = `${origin}/api/webhooks/whatsapp`;
    return (
        <div className="space-y-6 max-w-4xl">
            <FacebookSDKScript appId={process.env.NEXT_PUBLIC_META_APP_ID || ""} onReady={() => setFbSdkReady(true)} />

            <div>
                <h1 className="text-2xl font-bold tracking-tight">Meta business connection</h1>
                <p className="text-muted-foreground">Configure the WhatsApp Business Cloud API for this location.</p>
            </div>
            <WhatsAppNav />
            <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
                <AlertTriangle className="h-4 w-4 text-amber-700" aria-hidden="true" />
                <AlertTitle>Advanced setup</AlertTitle>
                <AlertDescription>Use this only when you need Meta-approved templates or official business features. For normal conversations, use the recommended linked-phone connection.</AlertDescription>
            </Alert>

            {/* Connection Status Banner */}
            {connectionStatus.type === 'success' && (
                <Alert className="border-green-200 bg-green-50 dark:bg-green-950/20">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <AlertTitle className="text-green-800 dark:text-green-200">WhatsApp Connected!</AlertTitle>
                    <AlertDescription className="text-green-700 dark:text-green-300">
                        {connectionStatus.message}
                    </AlertDescription>
                </Alert>
            )}

            {connectionStatus.type === 'error' && (
                <Alert variant="destructive">
                    <XCircle className="h-5 w-5" />
                    <AlertTitle>Connection Failed</AlertTitle>
                    <AlertDescription>
                        {connectionStatus.message}
                    </AlertDescription>
                </Alert>
            )}

            {/* Already Connected Status */}
            {settings.phoneNumberId && connectionStatus.type === 'idle' && (
                <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20">
                    <AlertCircle className="h-5 w-5 text-blue-600" />
                    <AlertTitle className="text-blue-800 dark:text-blue-200">WhatsApp Already Connected</AlertTitle>
                    <AlertDescription className="text-blue-700 dark:text-blue-300">
                        Phone Number ID: {settings.phoneNumberId}
                    </AlertDescription>
                </Alert>
            )}

            <div className="grid gap-6">
                <Card>
                    <CardHeader>
                        <CardTitle>1. Connection and phone numbers</CardTitle>
                        <CardDescription>
                            Manage Meta signup, business phone numbers, health checks, templates, and calling.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1">
                                <Label>Default Phone Number ID</Label>
                                <div className="rounded-md border px-3 py-2 text-sm">{settings.phoneNumberId || "Not configured"}</div>
                            </div>
                            <div className="space-y-1">
                                <Label>WABA ID</Label>
                                <div className="rounded-md border px-3 py-2 text-sm">{settings.businessAccountId || "Not configured"}</div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            <Button type="button" onClick={launchFacebookLogin} disabled={saving || (!fbSdkReady && !useBridge)}>
                                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Facebook className="mr-2 h-4 w-4" />}
                                Add Cloud API Number
                            </Button>
                            <Button type="button" variant="outline" onClick={() => refreshCloudOps(false)} disabled={cloudBusy}>
                                {cloudBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                Verify Cloud API
                            </Button>
                            <Button type="button" variant="outline" onClick={() => refreshCloudOps(true)} disabled={cloudBusy}>
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Refresh Templates
                            </Button>
                            <Button type="button" onClick={handleRepairCloud} disabled={cloudBusy}>
                                <Settings className="mr-2 h-4 w-4" />
                                Repair Default
                            </Button>
                        </div>

                        <div className="rounded-md border">
                            <div className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1.1fr] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                                <span>Number</span>
                                <span>Meta State</span>
                                <span>Quality</span>
                                <span>Coexistence</span>
                                <span className="text-right">Actions</span>
                            </div>
                            {settings.whatsappChannels.length > 0 ? (
                                settings.whatsappChannels.map((channel) => (
                                    <div key={channel.id} className="grid grid-cols-[1.2fr_1fr_0.8fr_0.8fr_1.1fr] items-center gap-2 px-3 py-3 text-sm">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 font-medium">
                                                <span className="truncate">{channel.displayPhoneNumber || channel.phoneNumberId}</span>
                                                {channel.isDefaultOutbound && (
                                                    <span className="rounded border px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">Default</span>
                                                )}
                                            </div>
                                            <div className="truncate text-xs text-muted-foreground">{channel.phoneNumberId}</div>
                                            {channel.verifiedName && <div className="truncate text-xs text-muted-foreground">{channel.verifiedName}</div>}
                                        </div>
                                        <span className="truncate">{channel.status || "unknown"}</span>
                                        <span className="truncate">{channel.qualityRating || "unknown"}</span>
                                        <span className={channel.coexistenceEnabled ? "text-green-700" : "text-muted-foreground"}>
                                            {channel.coexistenceEnabled ? "Enabled" : "Not detected"}
                                        </span>
                                        <div className="flex justify-end gap-2">
                                            <Button type="button" size="sm" variant="outline" onClick={() => handleVerifyChannel(channel.id)} disabled={cloudBusy}>
                                                Verify
                                            </Button>
                                            {!channel.isDefaultOutbound && (
                                                <Button type="button" size="sm" variant="outline" onClick={() => handleSetDefaultChannel(channel.id)} disabled={cloudBusy}>
                                                    Set Default
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="px-3 py-6 text-sm text-muted-foreground">
                                    No Cloud API numbers are synced yet. Add a number with Embedded Signup to avoid manual WhatsApp Manager setup.
                                </div>
                            )}
                        </div>

                        {cloudHealth?.checks && (
                            <div className="grid gap-2 sm:grid-cols-2">
                                {Object.entries(cloudHealth.checks).map(([key, check]: any) => (
                                    <div key={key} className="flex items-start gap-2 rounded-md border p-3 text-sm">
                                        {check.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" /> : <XCircle className="mt-0.5 h-4 w-4 text-red-600" />}
                                        <div>
                                            <div className="font-medium">{key.replace(/([A-Z])/g, " $1")}</div>
                                            {check.message && <div className="text-muted-foreground">{check.message}</div>}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        <Collapsible>
                            <CollapsibleTrigger asChild>
                                <Button type="button" variant="outline" className="min-h-11 w-full justify-between">
                                    2. Templates
                                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-3">
                        <div className="space-y-4 rounded-md border p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                    <div className="font-medium">Template Center</div>
                                    <div className="text-sm text-muted-foreground">Governed WhatsApp templates for Meta approval and outbound recovery.</div>
                                </div>
                                <Button type="button" variant="outline" onClick={() => loadTemplates()} disabled={cloudBusy}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Sync Catalog
                                </Button>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {["all", "approved", "pending", "rejected", "draft", "ready"].map((filter) => (
                                    <Button
                                        key={filter}
                                        type="button"
                                        size="sm"
                                        variant={templateFilter === filter ? "default" : "outline"}
                                        onClick={() => setTemplateFilter(filter)}
                                    >
                                        {filter.charAt(0).toUpperCase() + filter.slice(1)}
                                    </Button>
                                ))}
                            </div>

                            <div className="grid gap-4 lg:grid-cols-[1fr_0.95fr]">
                                <div className="space-y-3">
                                    <div className="rounded-md border">
                                        <div className="grid grid-cols-[1fr_0.55fr_0.55fr_0.7fr] gap-2 border-b px-3 py-2 text-xs font-medium text-muted-foreground">
                                            <span>Name</span>
                                            <span>Category</span>
                                            <span>Status</span>
                                            <span>Meta ID</span>
                                        </div>
                                        {templates.filter((template) => {
                                            if (templateFilter === "all") return true;
                                            if (templateFilter === "pending") return ["pending", "submitted"].includes(String(template.localStatus || template.status).toLowerCase());
                                            return String(template.localStatus || template.status).toLowerCase() === templateFilter;
                                        }).length > 0 ? (
                                            templates.filter((template) => {
                                                if (templateFilter === "all") return true;
                                                if (templateFilter === "pending") return ["pending", "submitted"].includes(String(template.localStatus || template.status).toLowerCase());
                                                return String(template.localStatus || template.status).toLowerCase() === templateFilter;
                                            }).map((template) => (
                                                <button
                                                    key={template.id || `${template.name}:${template.language}`}
                                                    type="button"
                                                    className="grid w-full grid-cols-[1fr_0.55fr_0.55fr_0.7fr] gap-2 px-3 py-3 text-left text-sm hover:bg-muted/50"
                                                    onClick={() => applyTemplateToBuilder(template)}
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block truncate font-medium">{template.name}</span>
                                                        <span className="block truncate text-xs text-muted-foreground">{template.language}</span>
                                                    </span>
                                                    <span><Badge variant="outline">{template.category}</Badge></span>
                                                    <span className="truncate">{template.localStatus || template.status}</span>
                                                    <span className="truncate text-xs text-muted-foreground">{template.metaTemplateId || "local"}</span>
                                                </button>
                                            ))
                                        ) : (
                                            <div className="px-3 py-6 text-sm text-muted-foreground">No templates in this view.</div>
                                        )}
                                    </div>

                                    <div className="space-y-3 rounded-md border p-3">
                                        <div className="flex items-center gap-2 font-medium">
                                            <Sparkles className="h-4 w-4" />
                                            AI Template Assistant
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-2">
                                            <select
                                                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                                                value={aiTemplateIntent}
                                                onChange={(e) => setAiTemplateIntent(e.target.value)}
                                            >
                                                {TEMPLATE_INTENTS.map((intent) => <option key={intent} value={intent}>{intent}</option>)}
                                            </select>
                                            <Input
                                                placeholder="Context, property type, audience, tone"
                                                value={aiTemplateNotes}
                                                onChange={(e) => setAiTemplateNotes(e.target.value)}
                                            />
                                        </div>
                                        <Button type="button" variant="outline" onClick={handleGenerateTemplateVariants} disabled={aiBusy || cloudBusy}>
                                            {aiBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wand2 className="mr-2 h-4 w-4" />}
                                            Generate Variants
                                        </Button>
                                        {aiVariants.length > 0 && (
                                            <div className="space-y-2">
                                                {aiVariants.map((variant, index) => (
                                                    <button
                                                        key={`${variant.name}-${index}`}
                                                        type="button"
                                                        className="w-full rounded-md border p-3 text-left text-sm hover:bg-muted/50"
                                                        onClick={() => applyTemplateToBuilder({ ...variant, aiPrompt: `${aiTemplateIntent}: ${aiTemplateNotes}`, aiRiskNotes: variant.riskNotes })}
                                                    >
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="font-medium">{variant.name}</span>
                                                            <Badge variant="outline">{variant.category}</Badge>
                                                        </div>
                                                        <div className="mt-2 whitespace-pre-wrap text-muted-foreground">{variant.previewText || variant.bodyText}</div>
                                                        {variant.riskNotes?.length > 0 && <div className="mt-2 text-xs text-amber-700">{variant.riskNotes.join(" ")}</div>}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="grid gap-3 rounded-md border p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="font-medium">Builder</div>
                                            <Button type="button" size="sm" variant="outline" onClick={() => setTemplateBuilder(EMPTY_TEMPLATE)}>New Draft</Button>
                                        </div>
                                        <div className="grid gap-3 sm:grid-cols-3">
                                            <div className="space-y-1">
                                                <Label>Name</Label>
                                                <Input
                                                    placeholder="viewing_reminder"
                                                    value={templateBuilder.name}
                                                    onChange={(e) => setTemplateBuilder({ ...templateBuilder, name: normalizeTemplateNameInput(e.target.value) })}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label>Language</Label>
                                                <Input
                                                    placeholder="en_US"
                                                    value={templateBuilder.language}
                                                    onChange={(e) => setTemplateBuilder({ ...templateBuilder, language: e.target.value })}
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <Label>Category</Label>
                                                <select
                                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                                    value={templateBuilder.category}
                                                    onChange={(e) => setTemplateBuilder({ ...templateBuilder, category: e.target.value })}
                                                >
                                                    <option value="UTILITY">Utility</option>
                                                    <option value="MARKETING">Marketing</option>
                                                    <option value="AUTHENTICATION">Authentication</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Header</Label>
                                            <Input
                                                placeholder="Optional text header"
                                                value={templateBuilder.headerText}
                                                onChange={(e) => setTemplateBuilder({ ...templateBuilder, headerText: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Body</Label>
                                            <Textarea
                                                className="min-h-28"
                                                placeholder="Hi {{1}}, your viewing for {{2}} is confirmed for {{3}}."
                                                value={templateBuilder.bodyText}
                                                onChange={(e) => setTemplateBuilder({ ...templateBuilder, bodyText: e.target.value })}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Footer</Label>
                                            <Input
                                                placeholder="Optional footer"
                                                value={templateBuilder.footerText}
                                                onChange={(e) => setTemplateBuilder({ ...templateBuilder, footerText: e.target.value })}
                                            />
                                        </div>
                                        {validateTemplateDraft(templateBuilder).variables.length > 0 && (
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                {validateTemplateDraft(templateBuilder).variables.map((variable) => (
                                                    <div key={variable} className="grid gap-1">
                                                        <Label>{`{{${variable}}}`}</Label>
                                                        <Input
                                                            placeholder="Sample value"
                                                            value={templateBuilder.examples[variable] || ""}
                                                            onChange={(e) => setTemplateBuilder({
                                                                ...templateBuilder,
                                                                examples: { ...templateBuilder.examples, [variable]: e.target.value },
                                                            })}
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex flex-wrap gap-2">
                                            <Button type="button" variant="outline" onClick={handleSaveTemplateDraft} disabled={cloudBusy}>
                                                <Save className="mr-2 h-4 w-4" />
                                                Save Draft
                                            </Button>
                                            <Button type="button" onClick={handleSubmitTemplate} disabled={cloudBusy || validateTemplateDraft(templateBuilder).errors.length > 0}>
                                                <Send className="mr-2 h-4 w-4" />
                                                Submit to Meta
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-3 rounded-md border p-3">
                                        <div className="font-medium">WhatsApp Preview</div>
                                        <div className="rounded-md bg-[#e7f6df] p-3">
                                            <div className="max-w-[92%] rounded-md bg-white p-3 text-sm shadow-sm">
                                                {templateBuilder.headerText && <div className="mb-2 font-semibold">{templateBuilder.headerText}</div>}
                                                <div className="whitespace-pre-wrap">{renderPreview(templateBuilder.bodyText || "Template body preview", templateBuilder.examples)}</div>
                                                {templateBuilder.footerText && <div className="mt-2 text-xs text-muted-foreground">{templateBuilder.footerText}</div>}
                                            </div>
                                        </div>
                                        <div className="space-y-2 text-sm">
                                            {validateTemplateDraft(templateBuilder).errors.length === 0 ? (
                                                <div className="flex items-center gap-2 text-green-700"><CheckCircle2 className="h-4 w-4" /> Ready for human review</div>
                                            ) : validateTemplateDraft(templateBuilder).errors.map((error) => (
                                                <div key={error} className="flex items-center gap-2 text-red-700"><XCircle className="h-4 w-4" /> {error}</div>
                                            ))}
                                            {validateTemplateDraft(templateBuilder).warnings.map((warning) => (
                                                <div key={warning} className="flex items-center gap-2 text-amber-700"><AlertTriangle className="h-4 w-4" /> {warning}</div>
                                            ))}
                                            {templateBuilder.aiRiskNotes?.map((note, index) => (
                                                <div key={`${note}-${index}`} className="flex items-center gap-2 text-muted-foreground"><AlertCircle className="h-4 w-4" /> {String(note)}</div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                            </CollapsibleContent>
                        </Collapsible>

                        <Collapsible>
                            <CollapsibleTrigger asChild>
                                <Button type="button" variant="outline" className="min-h-11 w-full justify-between">
                                    3. Calling
                                    <ChevronDown className="h-4 w-4" aria-hidden="true" />
                                </Button>
                            </CollapsibleTrigger>
                            <CollapsibleContent className="pt-3">
                        <div className="space-y-4 rounded-md border p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="font-medium">WhatsApp Business Calling API</div>
                                    <div className="text-sm text-muted-foreground">
                                        Official WABA calling path. WebBridge remains the free-text chat and consent-request transport.
                                    </div>
                                </div>
                                <Badge variant={callingReadiness?.ready ? "default" : "outline"}>
                                    {callingReadiness?.ready ? "Calling ready" : settings.whatsappCallingConfig.status || "not configured"}
                                </Badge>
                            </div>

                            {settings.whatsappChannels.length === 0 && (
                                <Alert variant="destructive">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>No WABA phone number available</AlertTitle>
                                    <AlertDescription>
                                        Official WhatsApp calling requires a WABA-registered Cloud API number. The existing WhatsApp app number cannot be used unless Meta or the BSP reports coexistence, or the number is migrated to API.
                                    </AlertDescription>
                                </Alert>
                            )}

                            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                                Same-number support is not assumed. If the current app number is not coexistence-enabled and cannot be migrated, configure a separate WABA calling-enabled number.
                            </div>

                            <div className="grid gap-3 md:grid-cols-3">
                                <div className="space-y-1">
                                    <Label>Provider</Label>
                                    <div className="rounded-md border px-3 py-2 text-sm">meta_calling_api</div>
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="callingPhoneNumberId">Cloud API Number</Label>
                                    <select
                                        id="callingPhoneNumberId"
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                        value={settings.whatsappCallingConfig.phoneNumberId || selectedCallingChannel?.phoneNumberId || ""}
                                        onChange={(event) => {
                                            const channel = settings.whatsappChannels.find((item) => item.phoneNumberId === event.target.value);
                                            setCallingConfig({
                                                phoneNumberId: event.target.value,
                                                wabaId: channel?.wabaId || "",
                                            });
                                        }}
                                    >
                                        <option value="">Select WABA number</option>
                                        {settings.whatsappChannels.map((channel) => (
                                            <option key={channel.id} value={channel.phoneNumberId}>
                                                {channel.displayPhoneNumber || channel.phoneNumberId}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <Label>WABA ID</Label>
                                    <div className="break-all rounded-md border px-3 py-2 text-sm">
                                        {settings.whatsappCallingConfig.wabaId || selectedCallingChannel?.wabaId || "Not selected"}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label>Coexistence</Label>
                                    <div className="rounded-md border px-3 py-2 text-sm">
                                        {selectedCallingChannel?.coexistenceEnabled ? "enabled" : "not reported"}
                                    </div>
                                </div>
                                <div className="space-y-1">
                                    <Label>Calling Enabled</Label>
                                    <select
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                        value={settings.whatsappCallingConfig.callingEnabled ? "yes" : "no"}
                                        onChange={(event) => setCallingConfig({ callingEnabled: event.target.value === "yes" })}
                                    >
                                        <option value="no">No</option>
                                        <option value="yes">Yes</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <Label>Call Webhooks</Label>
                                    <select
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                        value={settings.whatsappCallingConfig.webhooksEnabled ? "yes" : "no"}
                                        onChange={(event) => setCallingConfig({ webhooksEnabled: event.target.value === "yes" })}
                                    >
                                        <option value="no">Not enabled</option>
                                        <option value="yes">Enabled</option>
                                    </select>
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="callingMediaMode">Media Mode</Label>
                                    <select
                                        id="callingMediaMode"
                                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                        value={settings.whatsappCallingConfig.mediaMode}
                                        onChange={(event) => setCallingConfig({ mediaMode: event.target.value })}
                                    >
                                        <option value="sip">SIP</option>
                                        <option value="browser_webrtc">Browser WebRTC</option>
                                        <option value="manual_sdp">Manual SDP diagnostic</option>
                                        <option value="provider_managed">Provider managed</option>
                                    </select>
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                    <Label htmlFor="callingSipEndpoint">SIP Endpoint</Label>
                                    <Input
                                        id="callingSipEndpoint"
                                        value={settings.whatsappCallingConfig.sipEndpoint}
                                        onChange={(event) => setCallingConfig({ sipEndpoint: event.target.value })}
                                        placeholder="sip:calling.estio.co"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <Label htmlFor="callingMediaNotes">Calling notes</Label>
                                <Textarea
                                    id="callingMediaNotes"
                                    value={settings.whatsappCallingConfig.mediaNotes}
                                    onChange={(event) => setCallingConfig({ mediaNotes: event.target.value })}
                                    rows={3}
                                    placeholder="BSP enablement ticket, SIP trunk details, webhook subscription notes, media handoff status..."
                                />
                            </div>

                            <div className="grid gap-2 rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground md:grid-cols-3">
                                <div>
                                    <span className="font-medium text-foreground">Selected number: </span>
                                    {selectedCallingChannel?.displayPhoneNumber || settings.whatsappCallingConfig.phoneNumberId || "None"}
                                </div>
                                <div>
                                    <span className="font-medium text-foreground">Media path: </span>
                                    {settings.whatsappCallingConfig.mediaMode || "sip"}
                                </div>
                                <div>
                                    <span className="font-medium text-foreground">Last readiness: </span>
                                    {settings.whatsappCallingConfig.lastReadinessCheckedAt
                                        ? new Date(settings.whatsappCallingConfig.lastReadinessCheckedAt).toLocaleString()
                                        : "Never"}
                                </div>
                                {(callingReadiness?.errorMessage || settings.whatsappCallingConfig.lastError) && (
                                    <div className="md:col-span-3 text-amber-700">
                                        {callingReadiness?.errorMessage || settings.whatsappCallingConfig.lastError}
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Button type="button" onClick={handleSaveCallingConfig} disabled={callingBusy}>
                                    {callingBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Calling Config
                                </Button>
                                <Button type="button" variant="outline" onClick={handleCheckCallingReadiness} disabled={callingBusy}>
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Refresh Calling Readiness
                                </Button>
                            </div>
                        </div>
                            </CollapsibleContent>
                        </Collapsible>
                    </CardContent>
                </Card>

                {/* Embedded Signup Card */}
                <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/20">
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <Facebook className="h-5 w-5 text-blue-600" />
                            <span>Embedded signup</span>
                        </CardTitle>
                        <CardDescription>
                            Use Facebook Login for Business to automatically create/select your WABA and Phone Number.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            {!process.env.NEXT_PUBLIC_META_APP_ID && (
                                <div className="space-y-2">
                                    <Label>Meta App ID</Label>
                                    <Input
                                        placeholder="Your App ID"
                                        value={appId}
                                        onChange={(e) => setAppId(e.target.value)}
                                    />
                                </div>
                            )}
                            {!process.env.NEXT_PUBLIC_META_CONFIG_ID && (
                                <div className="space-y-2">
                                    <Label>Configuration ID</Label>
                                    <Input
                                        placeholder="Login Configuration ID"
                                        value={configId}
                                        onChange={(e) => setConfigId(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>

                        <Button
                            className="w-full bg-[#1877F2] hover:bg-[#166fe5]"
                            onClick={launchFacebookLogin}
                            disabled={saving || (!fbSdkReady && !useBridge)}
                        >
                            {saving ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Connecting...
                                </>
                            ) : (
                            "Add / Reconnect Cloud API Number"
                            )}
                        </Button>
                        {!useBridge && <FacebookSDKScript appId={appId} onReady={() => setFbSdkReady(true)} />}

                        <p className="text-xs text-muted-foreground">
                            Requires a Meta App configured with "Login for Business".
                        </p>
                    </CardContent>
                </Card>


                {/* Manual configuration Toggle */}
                <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-full justify-between text-muted-foreground">
                            <span className="flex items-center gap-2">
                                <Settings className="h-4 w-4" />
                                4. Manual configuration
                            </span>
                            <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-4 pt-4">
                        {/* Manual Configuration (Legacy/Fallback) */}
                        <Card>
                            <CardHeader>
                                <CardTitle>Manual Configuration</CardTitle>
                                <CardDescription>
                                    Enter the credentials manually if you prefer or if Embedded Signup is unavailable.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleSubmit} className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="waba-id">WhatsApp Business Account ID</Label>
                                            <Input
                                                id="waba-id"
                                                value={settings.businessAccountId}
                                                onChange={(e) => setSettings({ ...settings, businessAccountId: e.target.value })}
                                                placeholder="e.g. 10050..."
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label htmlFor="phone-id">Phone Number ID</Label>
                                            <Input
                                                id="phone-id"
                                                value={settings.phoneNumberId}
                                                onChange={(e) => setSettings({ ...settings, phoneNumberId: e.target.value })}
                                                placeholder="e.g. 112233..."
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="access-token">System User Access Token</Label>
                                        <Input
                                            id="access-token"
                                            type="password"
                                            value={settings.accessToken}
                                            onChange={(e) => setSettings({ ...settings, accessToken: e.target.value })}
                                            placeholder={settings.hasAccessToken ? "Configured (enter new value to replace)" : "Roughly 200 characters..."}
                                        />
                                        {settings.hasAccessToken && (
                                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <input
                                                    type="checkbox"
                                                    checked={clearWhatsAppAccessToken}
                                                    onChange={(e) => setClearWhatsAppAccessToken(e.target.checked)}
                                                    className="h-3.5 w-3.5 rounded border-gray-300"
                                                />
                                                Clear saved WhatsApp Access Token
                                            </label>
                                        )}
                                    </div>

                                    <div className="pt-4 flex justify-end">
                                        <Button type="submit" disabled={saving}>
                                            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                            Save Configuration
                                        </Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>

                        {settings.phoneNumberId && (
                            <Card>
                                <CardHeader>
                                    <CardTitle>Webhook Configuration</CardTitle>
                                    <CardDescription>
                                        Use these values to configure the Webhook in the Meta Developer Portal.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <Label>Callback URL</Label>
                                        <div className="flex items-center space-x-2">
                                            <code className="flex-1 rounded bg-muted p-2 font-mono text-sm">{webhookUrl}</code>
                                            <Button variant="outline" size="icon" onClick={() => copyToClipboard(webhookUrl)}>
                                                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                                            </Button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Verify Token</Label>
                                        <div className="flex items-center space-x-2">
                                            <code className="flex-1 rounded bg-muted p-2 font-mono text-sm">{settings.webhookSecret}</code>
                                            <Button variant="outline" size="icon" onClick={() => copyToClipboard(settings.webhookSecret)}>
                                                <Copy className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}
                    </CollapsibleContent>
                </Collapsible>
            </div>
        </div>
    );
}
