"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Bot, CheckCircle2, KeyRound, Loader2, LogIn, ShieldCheck, Terminal, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import {
    saveOpenAiIntegrationSettings,
    type OpenAiIntegrationActionState,
} from "./actions";

type ModelOption = {
    value: string;
    label: string;
    description?: string;
};

type OpenAiIntegrationFormProps = {
    initialData: {
        hasPersonalOpenAiApiKey: boolean;
        personalOpenAiEnabled: boolean;
        personalOpenAiDefaultTextModel: string;
        personalOpenAiModels: ModelOption[];
        hasLocationOpenAiApiKey: boolean;
        locationOpenAiTextModel: string;
        locationOpenAiModels: ModelOption[];
        hasChatGptSubscriptionAccessToken: boolean;
        chatGptSubscriptionEnabled: boolean;
        chatGptSubscriptionDefaultTextModel: string;
        chatGptSubscriptionModels: ModelOption[];
        chatGptSubscriptionTransportEnabled: boolean;
        chatGptSubscriptionSetup: {
            codexCliPath: string;
            codexCwd: string;
            transportEnvVar: string;
            requiredTransportValue: string;
            deviceAuthCommand: string;
            statusCommand: string;
            accessTokenCommand: string;
        };
    };
};

const initialState: OpenAiIntegrationActionState = {};
const CHATGPT_SUBSCRIPTION_API_PATH = "/api/admin/settings/integrations/openai/chatgpt-subscription";

function StatusPill({ ok, children }: { ok: boolean; children: ReactNode }) {
    return (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
            ok
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-slate-200 bg-slate-50 text-slate-600"
        }`}>
            {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            {children}
        </span>
    );
}

function SubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save OpenAI Settings
        </Button>
    );
}

function ModelSelect({
    id,
    name,
    defaultValue,
    models,
    onChange,
}: {
    id: string;
    name: string;
    defaultValue: string;
    models: ModelOption[];
    onChange?: (value: string) => void;
}) {
    const options = models.length > 0
        ? models
        : [{ value: defaultValue || "openai:gpt-4o-mini", label: "OpenAI GPT-4o Mini" }];

    return (
        <select
            id={id}
            name={name}
            defaultValue={defaultValue || options[0]?.value}
            onChange={onChange ? (event) => onChange(event.target.value) : undefined}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
            {options.map((model) => (
                <option key={model.value} value={model.value}>
                    {model.label}
                </option>
            ))}
        </select>
    );
}

export function OpenAiIntegrationForm({ initialData }: OpenAiIntegrationFormProps) {
    const [state, action] = useActionState(saveOpenAiIntegrationSettings, initialState);
    const [isConnectingSubscription, startSubscriptionConnectionTransition] = useTransition();
    const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
    const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
    const [subscriptionEnabled, setSubscriptionEnabled] = useState(initialData.chatGptSubscriptionEnabled);
    const [subscriptionModel, setSubscriptionModel] = useState(initialData.chatGptSubscriptionDefaultTextModel);
    const { toast } = useToast();

    useEffect(() => {
        if (!state.message && !state.error) return;
        toast({
            title: state.success ? "OpenAI settings saved" : "OpenAI settings error",
            description: state.message || state.error,
            variant: state.success ? undefined : "destructive",
        });
    }, [state, toast]);

    const runSubscriptionOperation = async (operation: "connect" | "disconnect") => {
        const response = await fetch(CHATGPT_SUBSCRIPTION_API_PATH, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operation, modelId: subscriptionModel }),
        });

        const payload = await response.json().catch(() => null);
        if (!payload || typeof payload !== "object") {
            return {
                success: false,
                error: response.ok
                    ? "ChatGPT subscription returned an unreadable response."
                    : `ChatGPT subscription request failed (${response.status}).`,
            };
        }

        return payload as OpenAiIntegrationActionState;
    };

    const connectSubscription = () => {
        setConnectionMessage(null);
        setConnectionOk(null);
        startSubscriptionConnectionTransition(async () => {
            const result = await runSubscriptionOperation("connect").catch((error: any) => ({
                success: false,
                error: error?.message || "ChatGPT subscription connection failed.",
            }));
            setConnectionOk(result.success === true);
            setConnectionMessage(result.message || result.error || null);
            if (result.success) {
                setSubscriptionEnabled(true);
            }
            toast({
                title: result.success ? "ChatGPT subscription connected" : "ChatGPT subscription not ready",
                description: result.message || result.error,
                variant: result.success ? undefined : "destructive",
            });
        });
    };

    const disconnectSubscription = () => {
        setConnectionMessage(null);
        setConnectionOk(null);
        startSubscriptionConnectionTransition(async () => {
            const result = await runSubscriptionOperation("disconnect").catch((error: any) => ({
                success: false,
                error: error?.message || "ChatGPT subscription disconnect failed.",
            }));
            setConnectionOk(result.success === true);
            setConnectionMessage(result.message || result.error || null);
            if (result.success) {
                setSubscriptionEnabled(false);
            }
            toast({
                title: result.success ? "ChatGPT subscription disconnected" : "Could not disconnect ChatGPT",
                description: result.message || result.error,
                variant: result.success ? undefined : "destructive",
            });
        });
    };

    return (
        <form action={action} className="space-y-6">
            <input type="hidden" name="chatGptSubscriptionEnabled" value={subscriptionEnabled ? "on" : ""} />
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <Bot className="h-5 w-5" />
                                ChatGPT Subscription
                            </CardTitle>
                            <CardDescription>
                                Use your ChatGPT subscription for AI drafts without entering an OpenAI Platform API key.
                            </CardDescription>
                        </div>
                        <StatusPill ok={subscriptionEnabled && initialData.chatGptSubscriptionTransportEnabled}>
                            {subscriptionEnabled && initialData.chatGptSubscriptionTransportEnabled
                                ? "Connected"
                                : subscriptionEnabled
                                    ? "Enabled, setup needed"
                                : initialData.chatGptSubscriptionTransportEnabled
                                    ? "Ready to connect"
                                    : "Admin setup needed"}
                        </StatusPill>
                    </div>
                </CardHeader>
                <CardContent className="space-y-5">
                    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                        <div className="font-medium">
                            {subscriptionEnabled ? "ChatGPT subscription is enabled" : "ChatGPT subscription is not connected"}
                        </div>
                        <div className="text-muted-foreground">
                            {subscriptionEnabled
                                ? "Estio will show ChatGPT subscription models in AI draft pickers."
                                : "Connect ChatGPT to show subscription models in AI draft pickers."}
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="chatGptSubscriptionDefaultTextModel">Model</Label>
                        <ModelSelect
                            id="chatGptSubscriptionDefaultTextModel"
                            name="chatGptSubscriptionDefaultTextModel"
                            defaultValue={subscriptionModel}
                            models={initialData.chatGptSubscriptionModels}
                            onChange={setSubscriptionModel}
                        />
                    </div>

                    <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-sm text-muted-foreground">
                            {initialData.chatGptSubscriptionTransportEnabled
                                ? "Connect once to enable subscription-backed models for your account."
                                : "A server admin must finish the trusted Codex login setup before users can connect."}
                        </div>
                        <div className="flex gap-2">
                            {subscriptionEnabled && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={disconnectSubscription}
                                    disabled={isConnectingSubscription}
                                >
                                    Disconnect
                                </Button>
                            )}
                            <Button
                                type="button"
                                onClick={connectSubscription}
                                disabled={isConnectingSubscription || !initialData.chatGptSubscriptionTransportEnabled}
                            >
                                {isConnectingSubscription ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <LogIn className="mr-2 h-4 w-4" />
                                )}
                                {subscriptionEnabled ? "Reconnect ChatGPT" : "Sign in with ChatGPT"}
                            </Button>
                        </div>
                    </div>

                    {connectionMessage && (
                        <div className={`rounded-md border px-3 py-2 text-sm ${
                            connectionOk
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-red-200 bg-red-50 text-red-700"
                        }`}>
                            {connectionMessage}
                        </div>
                    )}

                    {!initialData.chatGptSubscriptionTransportEnabled && (
                        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            ChatGPT subscription login is not ready on this server yet. API-key fallback settings are available below.
                        </div>
                    )}
                </CardContent>
            </Card>

            <details className="rounded-lg border bg-card">
                <summary className="cursor-pointer px-6 py-4 text-sm font-medium">
                    Advanced API key and token settings
                </summary>
                <div className="space-y-6 border-t p-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Terminal className="h-5 w-5" />
                                ChatGPT Login Setup
                            </CardTitle>
                            <CardDescription>
                                Server-side setup for trusted deployments. Normal users only use the sign-in button above.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-3 md:grid-cols-2">
                                <div className="rounded-md border bg-muted/30 p-3">
                                    <div className="text-xs font-medium uppercase text-muted-foreground">Transport</div>
                                    <code className="mt-1 block text-sm">
                                        {initialData.chatGptSubscriptionSetup.transportEnvVar}={initialData.chatGptSubscriptionSetup.requiredTransportValue}
                                    </code>
                                </div>
                                <div className="rounded-md border bg-muted/30 p-3">
                                    <div className="text-xs font-medium uppercase text-muted-foreground">Codex working directory</div>
                                    <code className="mt-1 block break-all text-sm">
                                        {initialData.chatGptSubscriptionSetup.codexCwd}
                                    </code>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label>Device login command</Label>
                                <code className="block overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-50">
                                    {initialData.chatGptSubscriptionSetup.deviceAuthCommand}
                                </code>
                            </div>

                            <div className="space-y-2">
                                <Label>Check login status</Label>
                                <code className="block overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-slate-50">
                                    {initialData.chatGptSubscriptionSetup.statusCommand}
                                </code>
                            </div>

                            <p className="text-sm text-muted-foreground">
                                OpenAI documents ChatGPT sign-in for Codex CLI, app, and IDE sessions. Estio uses that trusted Codex session; it does not handle ChatGPT browser cookies or expose a hosted OAuth callback.
                            </p>
                        </CardContent>
                    </Card>

                    <div className="grid gap-6 lg:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ShieldCheck className="h-5 w-5" />
                                    Organization API Key
                                </CardTitle>
                                <CardDescription>
                                    Shared OpenAI Platform fallback for this location.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <StatusPill ok={initialData.hasLocationOpenAiApiKey}>
                                    {initialData.hasLocationOpenAiApiKey ? "API key configured" : "No API key"}
                                </StatusPill>

                                <div className="grid gap-2">
                                    <Label htmlFor="locationOpenAiApiKey">OpenAI API key</Label>
                                    <Input
                                        id="locationOpenAiApiKey"
                                        name="locationOpenAiApiKey"
                                        type="password"
                                        placeholder="sk-..."
                                    />
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="locationOpenAiTextModel">Default organization model</Label>
                                    <ModelSelect
                                        id="locationOpenAiTextModel"
                                        name="locationOpenAiTextModel"
                                        defaultValue={initialData.locationOpenAiTextModel}
                                        models={initialData.locationOpenAiModels}
                                    />
                                </div>

                                {initialData.hasLocationOpenAiApiKey && (
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            name="clearLocationOpenAiApiKey"
                                            className="h-3.5 w-3.5 rounded border-gray-300"
                                        />
                                        Clear saved organization API key
                                    </label>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <KeyRound className="h-5 w-5" />
                                    Personal API Key
                                </CardTitle>
                                <CardDescription>
                                    Optional personal OpenAI Platform billing fallback.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5">
                                <StatusPill ok={initialData.hasPersonalOpenAiApiKey}>
                                    {initialData.hasPersonalOpenAiApiKey ? "Personal key configured" : "No personal key"}
                                </StatusPill>

                                <label className="flex items-center gap-2 text-sm">
                                    <input
                                        type="checkbox"
                                        name="personalOpenAiEnabled"
                                        defaultChecked={initialData.personalOpenAiEnabled}
                                        className="h-4 w-4 rounded border-gray-300"
                                    />
                                    Prefer my personal OpenAI API key
                                </label>

                                <div className="grid gap-2">
                                    <Label htmlFor="personalOpenAiApiKey">Personal API key</Label>
                                    <Input
                                        id="personalOpenAiApiKey"
                                        name="personalOpenAiApiKey"
                                        type="password"
                                        placeholder="sk-..."
                                    />
                                </div>

                                <div className="grid gap-2">
                                    <Label htmlFor="personalOpenAiDefaultTextModel">Default personal model</Label>
                                    <ModelSelect
                                        id="personalOpenAiDefaultTextModel"
                                        name="personalOpenAiDefaultTextModel"
                                        defaultValue={initialData.personalOpenAiDefaultTextModel}
                                        models={initialData.personalOpenAiModels}
                                    />
                                </div>

                                {initialData.hasPersonalOpenAiApiKey && (
                                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <input
                                            type="checkbox"
                                            name="clearPersonalOpenAiApiKey"
                                            className="h-3.5 w-3.5 rounded border-gray-300"
                                        />
                                        Clear saved personal API key
                                    </label>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Subscription Token Override</CardTitle>
                            <CardDescription>
                                Optional deployment fallback when server-managed login is unavailable.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="grid gap-2">
                                <Label htmlFor="chatGptSubscriptionAccessToken">Access token</Label>
                                <Input
                                    id="chatGptSubscriptionAccessToken"
                                    name="chatGptSubscriptionAccessToken"
                                    type="password"
                                    placeholder={initialData.hasChatGptSubscriptionAccessToken ? "Saved token configured" : "Optional"}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Leave this empty for normal subscription login. Use only for supported Codex access-token deployments.
                                </p>
                            </div>

                            {initialData.hasChatGptSubscriptionAccessToken && (
                                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <input
                                        type="checkbox"
                                        name="clearChatGptSubscriptionAccessToken"
                                        className="h-3.5 w-3.5 rounded border-gray-300"
                                    />
                                    Clear saved ChatGPT subscription token
                                </label>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </details>

            <div className="flex justify-end">
                <SubmitButton />
            </div>
        </form>
    );
}
