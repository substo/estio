"use client";

import { useState, useEffect } from "react";
import {
    getWhatsAppSettings,
    updateWhatsAppSettings,
    exchangeSystemUserToken,
    connectEvolutionDevice,
    logoutEvolutionInstance,
    checkInstanceHealth,
    repairEvolutionConnection,
    getWhatsAppCloudHealth,
    syncWhatsAppTemplates,
    listWhatsAppTemplates,
    repairWhatsAppCloudConnection,
    saveWhatsAppTemplateDraft,
    submitWhatsAppTemplateDraft,
    generateWhatsAppTemplateDrafts,
    setDefaultWhatsAppChannelAction,
    verifyWhatsAppCloudChannel,
    connectWhatsAppWebBridge,
    disconnectWhatsAppWebBridge,
    clearWhatsAppWebBridge,
    setWhatsAppWebBridgeDefault,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Copy, Check, Facebook, CheckCircle2, XCircle, AlertCircle, ChevronDown, Settings, RefreshCw, AlertTriangle, Sparkles, Send, Save, Wand2, QrCode, Unplug } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { FacebookSDKScript } from "@/components/integrations/facebook-sdk-script";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

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

export default function WhatsAppSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [qrCode, setQrCode] = useState<string | null>(null);
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
        // Evolution
        evolutionInstanceId: "",
        evolutionConnectionStatus: "close",
        whatsappProviderMode: "web_bridge",
        whatsappChannels: [] as WhatsAppChannelRow[],
        webBridgeSession: null as WhatsAppWebBridgeSessionRow | null,
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

    // Health Check State
    const [healthStatus, setHealthStatus] = useState<{
        status: 'idle' | 'checking' | 'healthy' | 'zombie' | 'disconnected' | 'syncing';
        contacts: number;
        chats: number;
    }>({ status: 'idle', contacts: 0, chats: 0 });

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
            evolutionInstanceId: data.evolutionInstanceId || "",
            evolutionConnectionStatus: data.evolutionConnectionStatus || "close",
            whatsappProviderMode: data.whatsappProviderMode || "web_bridge",
            whatsappChannels: Array.isArray(data.whatsappChannels) ? data.whatsappChannels : [],
            webBridgeSession: data.webBridgeSession || null,
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

    const handleConnectWebBridge = async () => {
        setCloudBusy(true);
        try {
            const result = await connectWhatsAppWebBridge(settings.locationId || null);
            await reloadSettings();
            toast({
                title: result.success ? "WhatsApp Web Bridge starting" : "Bridge start failed",
                description: result.success ? "Scan the QR code when it appears, then refresh status." : result.error,
                variant: result.success ? "default" : "destructive",
            });
        } catch (error: any) {
            toast({ title: "Bridge start failed", description: error?.message || "Unable to start bridge.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleDisconnectWebBridge = async () => {
        setCloudBusy(true);
        try {
            await disconnectWhatsAppWebBridge(settings.locationId || null);
            await reloadSettings();
            toast({ title: "WhatsApp Web Bridge disconnected" });
        } catch (error: any) {
            toast({ title: "Disconnect failed", description: error?.message || "Unable to disconnect bridge.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleClearWebBridge = async () => {
        setCloudBusy(true);
        try {
            await clearWhatsAppWebBridge(settings.locationId || null);
            await reloadSettings();
            toast({ title: "WhatsApp Web Bridge session cleared" });
        } catch (error: any) {
            toast({ title: "Clear failed", description: error?.message || "Unable to clear bridge session.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
        }
    };

    const handleSetWebBridgeDefault = async () => {
        setCloudBusy(true);
        try {
            await setWhatsAppWebBridgeDefault(settings.locationId || null);
            await reloadSettings();
            toast({ title: "Default transport updated", description: "New WhatsApp sends will use the Web Bridge." });
        } catch (error: any) {
            toast({ title: "Could not update default", description: error?.message || "Unable to set bridge as default.", variant: "destructive" });
        } finally {
            setCloudBusy(false);
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

    const performHealthCheck = async () => {
        if (settings.evolutionConnectionStatus !== 'open') return;

        setHealthStatus(prev => ({ ...prev, status: 'checking' }));
        try {
            const res = await checkInstanceHealth(settings.locationId || null);
            // @ts-ignore
            if (res && res.success) {
                // @ts-ignore
                setHealthStatus({
                    // @ts-ignore
                    status: res.status, // healthy, zombie, disconnected
                    // @ts-ignore
                    contacts: res.contactsCount || 0,
                    // @ts-ignore
                    chats: res.chatsCount || 0
                });
            }
        } catch (e) {
            console.error("Health check error", e);
        }
    };

    // Trigger health check when connected
    useEffect(() => {
        if (settings.evolutionConnectionStatus === 'open') {
            performHealthCheck();
        } else {
            setHealthStatus({ status: 'disconnected', contacts: 0, chats: 0 });
        }
    }, [settings.evolutionConnectionStatus]);

    const handleRepair = async () => {
        setRepairing(true);
        toast({ title: "Starting Repair", description: "Disconnecting and preparing new session..." });

        try {
            const res = await repairEvolutionConnection(settings.locationId || null);
            if (res.success && res.qrCode) {
                setSettings(prev => ({ ...prev, evolutionConnectionStatus: 'close' }));
                setQrCode(res.qrCode);
                setHealthStatus({ status: 'disconnected', contacts: 0, chats: 0 });
                toast({ title: "Ready to Scan", description: "Please scan the new QR code immediately." });
            } else {
                toast({ title: "Repair Failed", description: res.error || "Could not generate QR", variant: "destructive" });
            }
        } catch (e) {
            toast({ title: "Error", description: "Failed to repair connection.", variant: "destructive" });
        } finally {
            setRepairing(false);
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

    // Polling for connection status when QR code is visible
    useEffect(() => {
        if (!qrCode) return;

        const interval = setInterval(async () => {
            const data = await getWhatsAppSettings(settings.locationId || null);
            if (data && data.evolutionConnectionStatus === 'open') {
                setSettings(prev => ({ ...prev, evolutionConnectionStatus: 'open' }));
                setQrCode(null); // Clear QR code to show success state
                toast({ title: "Connected", description: "WhatsApp device connected successfully." });
                clearInterval(interval);
            }
        }, 3000);

        return () => clearInterval(interval);
    }, [qrCode]);

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
                <h1 className="text-2xl font-bold tracking-tight">WhatsApp Configuration</h1>
                <p className="text-muted-foreground">Setup your direct connection to the WhatsApp Business Cloud API.</p>
            </div>

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
                        <CardTitle>Cloud API Enterprise</CardTitle>
                        <CardDescription>
                            Primary outbound transport, Meta health checks, webhook subscription, and template operations.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <div className="space-y-1">
                                <Label htmlFor="whatsappProviderMode">Provider Mode</Label>
                                <select
                                    id="whatsappProviderMode"
                                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                                    value={settings.whatsappProviderMode}
                                    onChange={(e) => setSettings({ ...settings, whatsappProviderMode: e.target.value })}
                                >
                                    <option value="cloud_primary">Cloud API Primary</option>
                                    <option value="web_bridge">WhatsApp Web Bridge</option>
                                    <option value="evolution_linked">Evolution Legacy Linked Device</option>
                                    <option value="twilio_fallback">Twilio Fallback</option>
                                </select>
                            </div>
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

                        <div className="space-y-4 rounded-md border p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="font-medium">WhatsApp Web Bridge</div>
                                    <div className="text-sm text-muted-foreground">
                                        Self-hosted linked-device transport for normal free-text WhatsApp conversations and manual mobile/web echoes.
                                    </div>
                                </div>
                                <Badge variant={settings.webBridgeSession?.status === "ready" ? "default" : "outline"}>
                                    {settings.webBridgeSession?.status || "not paired"}
                                </Badge>
                            </div>

                            <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                                <div className="flex min-h-[220px] items-center justify-center rounded-md border bg-muted/20 p-3">
                                    {settings.webBridgeSession?.qrCode ? (
                                        <img src={settings.webBridgeSession.qrCode} alt="WhatsApp Web QR code" className="h-48 w-48 rounded bg-white p-2" />
                                    ) : (
                                        <QrCode className="h-16 w-16 text-muted-foreground" />
                                    )}
                                </div>
                                <div className="space-y-3 text-sm">
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs text-muted-foreground">Session</div>
                                            <div className="truncate font-medium">{settings.webBridgeSession?.sessionId || "Not created"}</div>
                                        </div>
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs text-muted-foreground">Phone</div>
                                            <div className="truncate font-medium">{settings.webBridgeSession?.phone || "Not connected"}</div>
                                        </div>
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs text-muted-foreground">Last Ready</div>
                                            <div className="truncate font-medium">
                                                {settings.webBridgeSession?.lastReadyAt ? new Date(settings.webBridgeSession.lastReadyAt).toLocaleString() : "Never"}
                                            </div>
                                        </div>
                                        <div className="rounded-md border p-3">
                                            <div className="text-xs text-muted-foreground">Default</div>
                                            <div className="truncate font-medium">{settings.whatsappProviderMode === "web_bridge" ? "Yes" : "No"}</div>
                                        </div>
                                    </div>
                                    {settings.webBridgeSession?.lastError && (
                                        <Alert variant="destructive">
                                            <AlertTriangle className="h-4 w-4" />
                                            <AlertTitle>Bridge Error</AlertTitle>
                                            <AlertDescription>{settings.webBridgeSession.lastError}</AlertDescription>
                                        </Alert>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        <Button type="button" onClick={handleConnectWebBridge} disabled={cloudBusy}>
                                            {cloudBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrCode className="mr-2 h-4 w-4" />}
                                            Connect / Restart
                                        </Button>
                                        <Button type="button" variant="outline" onClick={reloadSettings} disabled={cloudBusy}>
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                            Refresh Status
                                        </Button>
                                        <Button type="button" variant="outline" onClick={handleSetWebBridgeDefault} disabled={cloudBusy || settings.webBridgeSession?.status !== "ready"}>
                                            <CheckCircle2 className="mr-2 h-4 w-4" />
                                            Set Default
                                        </Button>
                                        <Button type="button" variant="outline" onClick={handleDisconnectWebBridge} disabled={cloudBusy || !settings.webBridgeSession}>
                                            <Unplug className="mr-2 h-4 w-4" />
                                            Disconnect
                                        </Button>
                                        <Button type="button" variant="outline" onClick={handleClearWebBridge} disabled={cloudBusy || !settings.webBridgeSession}>
                                            Clear Session
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>

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
                    </CardContent>
                </Card>

                {/* Legacy Evolution linked-device card */}
                <Card className="border-amber-200 dark:border-amber-900 bg-amber-50/20">
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <span className="text-amber-700 font-bold">Legacy Evolution Linked Device</span>
                            <Badge variant="outline">Deprecated</Badge>
                        </CardTitle>
                        <CardDescription>
                            Legacy fallback for older locations and history import. New normal WhatsApp chat should use WhatsApp Web Bridge above.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {settings.evolutionConnectionStatus === 'open' ? (
                            <div className="flex flex-col items-center justify-center space-y-4 p-6 border rounded-lg bg-green-50/50">
                                <CheckCircle2 className="h-12 w-12 text-green-500" />
                                <div className="text-center">
                                    <h3 className="font-medium text-lg text-green-700">Device Connected</h3>
                                    <p className="text-sm text-green-600">Legacy Evolution API is active for this location.</p>
                                </div>

                                {/* Health Check / Zombie Repair Section */}
                                <div className="w-full">
                                    {healthStatus.status === 'checking' && (
                                        <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground p-2">
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                            <span>Verifying sync status...</span>
                                        </div>
                                    )}

                                    {healthStatus.status === 'syncing' && (
                                        <Alert className="border-blue-200 bg-blue-50 dark:bg-blue-950/20 mt-2 mb-4">
                                            <RefreshCw className="h-4 w-4 text-blue-600 animate-spin" />
                                            <AlertTitle className="text-blue-800 dark:text-blue-200 text-sm font-bold">
                                                Syncing Contacts...
                                            </AlertTitle>
                                            <AlertDescription className="text-blue-700 dark:text-blue-300 text-xs mt-1">
                                                New connection detected. Please wait while WhatsApp syncs your contacts and chats. This may take a few minutes.
                                                <div className="mt-2">
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={performHealthCheck}
                                                        className="h-6 text-[10px] text-blue-700 hover:bg-blue-100"
                                                    >
                                                        Refresh Status
                                                    </Button>
                                                </div>
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    {healthStatus.status === 'zombie' && (
                                        <Alert className="border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 mt-2 mb-4">
                                            <AlertTriangle className="h-4 w-4 text-yellow-600" />
                                            <AlertTitle className="text-yellow-800 dark:text-yellow-200 text-sm font-bold">
                                                Connection Unhealthy (Zombie State)
                                            </AlertTitle>
                                            <AlertDescription className="text-yellow-700 dark:text-yellow-300 text-xs mt-1">
                                                The device is connected but showing <strong>0 synced contacts</strong>. This can happen after updates or server restarts. Messages may not be received correctly.
                                                <div className="mt-3">
                                                    <Button
                                                        size="sm"
                                                        variant="destructive"
                                                        onClick={handleRepair}
                                                        disabled={repairing}
                                                        className="w-full sm:w-auto"
                                                    >
                                                        {repairing ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-2 h-3 w-3" />}
                                                        Repair Connection (Re-Scan)
                                                    </Button>
                                                </div>
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    {healthStatus.status === 'healthy' && (
                                        <div className="text-xs text-center text-muted-foreground mt-2 border-t pt-2">
                                            <div className="flex justify-center space-x-4">
                                                <span>Contacts: <strong>{healthStatus.contacts}</strong></span>
                                                <span>Chats: <strong>{healthStatus.chats}</strong></span>
                                            </div>
                                            <div className="flex items-center justify-center gap-2 mt-2">
                                                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={performHealthCheck}>
                                                    Refresh Status
                                                </Button>
                                                <span className="text-muted-foreground/30">|</span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-[10px] text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                                                    onClick={handleRepair}
                                                    disabled={repairing}
                                                >
                                                    {repairing ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                                                    Force Re-scan
                                                </Button>
                                                <span className="text-muted-foreground/30">|</span>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-6 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                                    onClick={async () => {
                                                        setSaving(true);
                                                        try {
                                                            const { resetWebhookUrl } = await import("./actions");
                                                            const res = await resetWebhookUrl();
                                                            if (res.success) {
                                                                toast({ title: "Webhook Updated", description: `Re-set to: ${res.url}` });
                                                            } else {
                                                                toast({ title: "Error", description: res.error, variant: "destructive" });
                                                            }
                                                        } catch (e) {
                                                            toast({ title: "Error", description: "Failed to reset webhook", variant: "destructive" });
                                                        }
                                                        setSaving(false);
                                                    }}
                                                    disabled={saving}
                                                >
                                                    <RefreshCw className="mr-1 h-3 w-3" />
                                                    Re-sync Webhook
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className="border-red-200 text-red-600 hover:bg-red-50 mt-2"
                                            disabled={saving || repairing}
                                        >
                                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                            Disconnect Device
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will disconnect the current WhatsApp session. You will need to scan the QR code again to reconnect.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                                                onClick={async () => {
                                                    setSaving(true);
                                                    await logoutEvolutionInstance(settings.locationId || null);
                                                    setSettings(prev => ({ ...prev, evolutionConnectionStatus: 'close' }));
                                                    setHealthStatus({ status: 'disconnected', contacts: 0, chats: 0 });
                                                    setSaving(false);
                                                    toast({ title: "Disconnected", description: "Linked device disconnected." });
                                                }}
                                            >
                                                Disconnect
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center space-y-4">
                                {qrCode ? (
                                    <div className="flex flex-col items-center space-y-4">
                                        <div className="bg-white p-2 rounded-lg border shadow-sm">
                                            {/* eslint-disable-next-line @next/next/no-img-element */}
                                            <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
                                        </div>
                                        <p className="text-sm text-center text-muted-foreground max-w-xs">
                                            Open WhatsApp on your phone {'>'} Menu {'>'} Linked devices {'>'} Link a device.
                                        </p>
                                        <Button
                                            variant="ghost"
                                            onClick={() => setQrCode(null)}
                                            size="sm"
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="text-center space-y-4">
                                        <p className="text-sm text-muted-foreground">
                                            Legacy Evolution connection. Prefer WhatsApp Web Bridge for new linked-device sessions.
                                        </p>
                                        {repairing && (
                                            <Alert className="mb-4 border-yellow-200 bg-yellow-50">
                                                <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
                                                <AlertDescription className="text-yellow-700 text-xs">
                                                    Resetting connection instance...
                                                </AlertDescription>
                                            </Alert>
                                        )}
                                        <Button
                                            className="bg-amber-600 hover:bg-amber-700 text-white"
                                            onClick={async () => {
                                                setSaving(true);
                                                try {
                                                    const res = await connectEvolutionDevice(settings.locationId || null);
                                                    if (res.success && res.qrCode) {
                                                        setQrCode(res.qrCode);
                                                        toast({ title: "Scan QR Code", description: "QR Code generated successfully." });
                                                    } else if (res.success) {
                                                        toast({ title: "Connected", description: "Instance seems already connected or connecting." });
                                                        // Refresh settings
                                                        const data = await getWhatsAppSettings(settings.locationId || null);
                                                        if (data) setSettings(prev => ({ ...prev, evolutionConnectionStatus: data.evolutionConnectionStatus || 'close' }));
                                                    } else {
                                                        toast({ title: "Error", description: res.error || "Failed to generate QR", variant: "destructive" });
                                                    }
                                                } catch (e: any) {
                                                    toast({ title: "Error", description: "Failed to connect", variant: "destructive" });
                                                }
                                                setSaving(false);
                                            }}
                                            disabled={saving || repairing}
                                        >
                                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                            Connect Legacy Device
                                        </Button>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Embedded Signup Card */}
                <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/20">
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <Facebook className="h-5 w-5 text-blue-600" />
                            <span>Embedded Signup (Recommended)</span>
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

                {/* Twilio Configuration Card */}
                <Card className="border-red-200 dark:border-red-900 bg-red-50/20">
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <span className="text-red-600 font-bold">Twilio</span>
                            <span>Provider (BYON)</span>
                        </CardTitle>
                        <CardDescription>
                            Use Twilio if you want to Bring Your Own Number or use a virtual number.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="twilio-sid">Account SID</Label>
                                <Input
                                    id="twilio-sid"
                                    value={settings.twilioAccountSid}
                                    onChange={(e) => setSettings({ ...settings, twilioAccountSid: e.target.value })}
                                    placeholder="AC..."
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="twilio-token">Auth Token</Label>
                                <Input
                                    id="twilio-token"
                                    type="password"
                                    value={settings.twilioAuthToken}
                                    onChange={(e) => setSettings({ ...settings, twilioAuthToken: e.target.value })}
                                    placeholder={settings.hasTwilioAuthToken ? "Configured (enter new value to replace)" : "Enter Auth Token"}
                                />
                                {settings.hasTwilioAuthToken && (
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            checked={clearTwilioAuthToken}
                                            onChange={(e) => setClearTwilioAuthToken(e.target.checked)}
                                            className="h-3.5 w-3.5 rounded border-gray-300"
                                        />
                                        Clear saved Twilio Auth Token
                                    </label>
                                )}
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="twilio-from">WhatsApp Sender Number</Label>
                                <Input
                                    id="twilio-from"
                                    value={settings.twilioWhatsAppFrom}
                                    onChange={(e) => setSettings({ ...settings, twilioWhatsAppFrom: e.target.value })}
                                    placeholder="e.g. +1234567890 (or 'whatsapp:+1...')"
                                />
                                <p className="text-xs text-muted-foreground">
                                    The number you registered in Twilio Console.
                                </p>
                            </div>

                            <div className="pt-2 flex justify-end">
                                <Button type="submit" disabled={saving} variant="outline" className="border-red-200 hover:bg-red-50 text-red-700">
                                    {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Save Twilio Settings
                                </Button>
                            </div>
                        </form>

                        {settings.twilioAccountSid && (
                            <div className="mt-6 pt-6 border-t border-red-100 dark:border-red-900/50">
                                <h4 className="text-sm font-medium mb-3 text-red-800 dark:text-red-300">Webhook Configuration</h4>
                                <div className="space-y-2">
                                    <Label className="text-xs">
                                        Twilio Sandbox / Messaging Service Webhook URL
                                    </Label>
                                    <div className="flex items-center space-x-2">
                                        <code className="flex-1 rounded bg-muted p-2 font-mono text-xs">{`${origin}/api/webhooks/twilio`}</code>
                                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => copyToClipboard(`${origin}/api/webhooks/twilio`)}>
                                            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                        </Button>
                                    </div>
                                    <p className="text-[10px] text-muted-foreground">
                                        Paste this URL into your Twilio Console "Sandbox Settings" or "Messaging Service" Integration settings.
                                    </p>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Advanced Options Toggle */}
                <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                    <CollapsibleTrigger asChild>
                        <Button variant="ghost" className="w-full justify-between text-muted-foreground">
                            <span className="flex items-center gap-2">
                                <Settings className="h-4 w-4" />
                                Advanced Options
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
