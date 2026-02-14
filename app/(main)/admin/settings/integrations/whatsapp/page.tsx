"use client";

import { useState, useEffect } from "react";
import { getWhatsAppSettings, updateWhatsAppSettings, exchangeSystemUserToken, connectEvolutionDevice, logoutEvolutionInstance, checkInstanceHealth, repairEvolutionConnection } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Copy, Check, Facebook, CheckCircle2, XCircle, AlertCircle, ChevronDown, Settings, RefreshCw, AlertTriangle } from "lucide-react";
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

export default function WhatsAppSettingsPage() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [settings, setSettings] = useState({
        businessAccountId: "",
        phoneNumberId: "",
        accessToken: "",
        webhookSecret: "",
        locationId: "",
        // Twilio
        twilioAccountSid: "",
        twilioAuthToken: "",
        twilioWhatsAppFrom: "",
        // Evolution
        evolutionInstanceId: "",
        evolutionConnectionStatus: "close",
    });

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

    const performHealthCheck = async () => {
        if (settings.evolutionConnectionStatus !== 'open') return;

        setHealthStatus(prev => ({ ...prev, status: 'checking' }));
        try {
            const res = await checkInstanceHealth();
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
            const res = await repairEvolutionConnection();
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

        if (code) {
            // System User Access Token flow - exchange code for token
            try {
                const result = await exchangeSystemUserToken(code, appId);

                if (result.success) {
                    setConnectionStatus({ type: 'success', message: result.message });
                    toast({ title: "Success", description: result.message });
                    const data = await getWhatsAppSettings();
                    if (data) {
                        setSettings({
                            businessAccountId: data.businessAccountId || "",
                            phoneNumberId: data.phoneNumberId || "",
                            accessToken: data.accessToken || "",
                            webhookSecret: data.webhookSecret || "",
                            locationId: data.locationId || "",
                            twilioAccountSid: data.twilioAccountSid || "",
                            twilioAuthToken: data.twilioAuthToken || "",
                            twilioWhatsAppFrom: data.twilioWhatsAppFrom || "",
                            evolutionInstanceId: data.evolutionInstanceId || "",
                            evolutionConnectionStatus: data.evolutionConnectionStatus || "close",
                        });
                    }
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
                const result = await exchangeSystemUserToken(accessToken, appId, undefined, true);

                if (result.success) {
                    setConnectionStatus({ type: 'success', message: result.message });
                    toast({ title: "Success", description: result.message });
                    const data = await getWhatsAppSettings();
                    if (data) {
                        setSettings({
                            businessAccountId: data.businessAccountId || "",
                            phoneNumberId: data.phoneNumberId || "",
                            accessToken: data.accessToken || "",
                            webhookSecret: data.webhookSecret || "",
                            locationId: data.locationId || "",
                            twilioAccountSid: data.twilioAccountSid || "",
                            twilioAuthToken: data.twilioAuthToken || "",
                            twilioWhatsAppFrom: data.twilioWhatsAppFrom || "",
                            evolutionInstanceId: data.evolutionInstanceId || "",
                            evolutionConnectionStatus: data.evolutionConnectionStatus || "close",
                        });
                    }
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
        getWhatsAppSettings().then((data) => {
            if (data) {
                setSettings({
                    businessAccountId: data.businessAccountId || "",
                    phoneNumberId: data.phoneNumberId || "",
                    accessToken: data.accessToken || "",
                    webhookSecret: data.webhookSecret || crypto.randomUUID(),
                    locationId: data.locationId || "",
                    // Twilio
                    twilioAccountSid: data.twilioAccountSid || "",
                    twilioAuthToken: data.twilioAuthToken || "",
                    twilioWhatsAppFrom: data.twilioWhatsAppFrom || "",
                    // Evolution
                    evolutionInstanceId: data.evolutionInstanceId || "",
                    evolutionConnectionStatus: data.evolutionConnectionStatus || "close",
                });
            }
            setLoading(false);
        });
    }, []);

    // Polling for connection status when QR code is visible
    useEffect(() => {
        if (!qrCode) return;

        const interval = setInterval(async () => {
            const data = await getWhatsAppSettings();
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
        formData.append("businessAccountId", settings.businessAccountId);
        formData.append("phoneNumberId", settings.phoneNumberId);
        formData.append("accessToken", settings.accessToken);
        formData.append("webhookSecret", settings.webhookSecret);

        // Twilio
        formData.append("twilioAccountSid", settings.twilioAccountSid);
        formData.append("twilioAuthToken", settings.twilioAuthToken);
        formData.append("twilioWhatsAppFrom", settings.twilioWhatsAppFrom);

        try {
            await updateWhatsAppSettings(formData);
            toast({ title: "Settings saved", description: "WhatsApp configuration updated successfully." });
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

                {/* Linked Device (Shadow API) Card */}
                <Card className="border-purple-200 dark:border-purple-900 bg-purple-50/20">
                    <CardHeader>
                        <CardTitle className="flex items-center space-x-2">
                            <span className="text-purple-600 font-bold">WhatsApp Coexistence</span>
                            <span>(Linked Device)</span>
                        </CardTitle>
                        <CardDescription>
                            Connect your existing WhatsApp Business App via QR code to use it simultaneously with Estio.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {settings.evolutionConnectionStatus === 'open' ? (
                            <div className="flex flex-col items-center justify-center space-y-4 p-6 border rounded-lg bg-green-50/50">
                                <CheckCircle2 className="h-12 w-12 text-green-500" />
                                <div className="text-center">
                                    <h3 className="font-medium text-lg text-green-700">Device Connected</h3>
                                    <p className="text-sm text-green-600">Shadow API is active and syncing messages.</p>
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
                                                    await logoutEvolutionInstance();
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
                                            Scan a QR code to link your phone. This works just like WhatsApp Web without disconnecting your phone.
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
                                            className="bg-purple-600 hover:bg-purple-700 text-white"
                                            onClick={async () => {
                                                setSaving(true);
                                                try {
                                                    const res = await connectEvolutionDevice();
                                                    if (res.success && res.qrCode) {
                                                        setQrCode(res.qrCode);
                                                        toast({ title: "Scan QR Code", description: "QR Code generated successfully." });
                                                    } else if (res.success) {
                                                        toast({ title: "Connected", description: "Instance seems already connected or connecting." });
                                                        // Refresh settings
                                                        const data = await getWhatsAppSettings();
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
                                            Connect Linked Device
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
                                "Connect with Facebook"
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
                                    placeholder={settings.twilioAuthToken ? "********" : "Enter Auth Token"}
                                />
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
                                            placeholder="Roughly 200 characters..."
                                        />
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

