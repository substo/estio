'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { completeUserProfile, testChatGptSubscriptionConnection } from '@/app/(main)/admin/profile-actions';
import { useToast } from '@/components/ui/use-toast';
import { Loader2, PlugZap } from 'lucide-react';

interface UserProfileFormProps {
    initialData: {
        firstName: string;
        lastName: string;
        phone: string;
        email: string;
        timeZone: string;
        hasUserOpenAiApiKey: boolean;
        openAiEnabled: boolean;
        openAiDefaultTextModel: string;
        openAiModels: Array<{
            value: string;
            label: string;
            description?: string;
        }>;
        hasChatGptSubscriptionAccessToken: boolean;
        chatGptSubscriptionEnabled: boolean;
        chatGptSubscriptionDefaultTextModel: string;
        chatGptSubscriptionModels: Array<{
            value: string;
            label: string;
            description?: string;
        }>;
        chatGptSubscriptionTransportEnabled: boolean;
        chatGptSubscriptionSetupGuide: {
            codexCliPath: string;
            codexCwd: string;
            transportEnvVar: string;
            requiredTransportValue: string;
            deviceAuthCommand: string;
            statusCommand: string;
            accessTokenCommand: string;
            notes: string[];
        };
    };
}

export function UserProfileForm({ initialData }: UserProfileFormProps) {
    const [isPending, startTransition] = useTransition();
    const [isTestingSubscription, startSubscriptionTestTransition] = useTransition();
    const [subscriptionTestMessage, setSubscriptionTestMessage] = useState<string | null>(null);
    const [subscriptionTestOk, setSubscriptionTestOk] = useState<boolean | null>(null);
    const { toast } = useToast();

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);

        startTransition(async () => {
            const result = await completeUserProfile(formData);
            if (result.success) {
                toast({
                    title: "Profile Updated",
                    description: "Your profile has been updated successfully.",
                });
            } else {
                toast({
                    title: "Error",
                    description: result.error || "Failed to update profile",
                    variant: "destructive",
                });
            }
        });
    };

    const handleTestChatGptSubscription = () => {
        setSubscriptionTestMessage(null);
        setSubscriptionTestOk(null);
        startSubscriptionTestTransition(async () => {
            const result = await testChatGptSubscriptionConnection();
            setSubscriptionTestOk(result.success);
            setSubscriptionTestMessage(result.success ? result.message || 'Connection test passed.' : result.error || 'Connection test failed.');
            toast({
                title: result.success ? 'Connection Ready' : 'Connection Failed',
                description: result.success ? result.message || 'ChatGPT subscription transport is ready.' : result.error || 'ChatGPT subscription transport is not ready.',
                variant: result.success ? undefined : 'destructive',
            });
        });
    };

    return (
        <Card className="w-full">
            <CardHeader className="pb-4">
                <CardTitle>Team Profile Details</CardTitle>
                <CardDescription>
                    Update your internal team profile details. These are synced with GoHighLevel.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="firstName">First Name</Label>
                            <Input
                                id="firstName"
                                name="firstName"
                                defaultValue={initialData.firstName}
                                required
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lastName">Last Name</Label>
                            <Input
                                id="lastName"
                                name="lastName"
                                defaultValue={initialData.lastName}
                                required
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="phone">Phone Number</Label>
                            <Input
                                id="phone"
                                name="phone"
                                type="tel"
                                defaultValue={initialData.phone}
                                disabled
                                className="bg-muted text-muted-foreground"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Phone number is managed via your account verification settings.
                            </p>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="email">Email</Label>
                            <Input
                                id="email"
                                value={initialData.email}
                                disabled
                                className="bg-muted text-muted-foreground"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Email is managed via your account settings.
                            </p>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="timeZone">Timezone (IANA)</Label>
                        <Input
                            id="timeZone"
                            name="timeZone"
                            defaultValue={initialData.timeZone}
                            placeholder="e.g. Europe/Nicosia"
                            required
                            list="common-timezones"
                        />
                        <datalist id="common-timezones">
                            <option value="Europe/Nicosia" />
                            <option value="Europe/Athens" />
                            <option value="Europe/London" />
                            <option value="UTC" />
                            <option value="Asia/Dubai" />
                            <option value="America/New_York" />
                        </datalist>
                        <p className="text-[10px] text-muted-foreground">
                            Used for viewing scheduling. Must be a valid IANA timezone.
                        </p>
                    </div>

                    <div className="rounded-md border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                        <input type="hidden" name="openAiSettingsSubmitted" value="1" />
                        <div className="space-y-1">
                            <Label className="text-sm font-medium">Personal OpenAI API Key</Label>
                            <p className="text-[10px] text-muted-foreground">
                                Used only for your text-generation AI requests when you select an OpenAI model. Location/admin keys are used as fallback.
                            </p>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                name="openAiEnabled"
                                defaultChecked={initialData.openAiEnabled}
                                className="h-4 w-4 rounded border-gray-300 text-indigo-600"
                            />
                            Enable my personal OpenAI key
                        </label>
                        <div className="space-y-2">
                            <Label htmlFor="openAiApiKey">OpenAI API Key</Label>
                            <Input
                                id="openAiApiKey"
                                name="openAiApiKey"
                                type="password"
                                placeholder="sk-..."
                            />
                            {initialData.hasUserOpenAiApiKey && (
                                <div className="flex items-center gap-2 text-xs text-emerald-700">
                                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                    Personal OpenAI API key is configured.
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="openAiDefaultTextModel">Default OpenAI text model</Label>
                            <select
                                id="openAiDefaultTextModel"
                                name="openAiDefaultTextModel"
                                defaultValue={initialData.openAiDefaultTextModel}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                {initialData.openAiModels.map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </select>
                            <p className="text-[10px] text-muted-foreground">
                                Used as your preferred OpenAI option in text-generation model pickers.
                            </p>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                                type="checkbox"
                                name="clearOpenAiApiKey"
                                className="h-3.5 w-3.5 rounded border-gray-300 text-red-600"
                            />
                            Clear saved personal OpenAI API key
                        </label>
                    </div>

                    <div className="rounded-md border border-amber-200 bg-amber-50/70 p-4 space-y-4">
                        <div className="space-y-1">
                            <Label className="text-sm font-medium">ChatGPT Subscription Auth</Label>
                            <p className="text-[10px] text-muted-foreground">
                                Experimental text-generation path using Codex/ChatGPT subscription auth on trusted servers. This is separate from OpenAI Platform API keys.
                            </p>
                            <div className={`inline-flex items-center gap-2 rounded border px-2 py-1 text-[11px] ${
                                initialData.chatGptSubscriptionTransportEnabled
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-amber-200 bg-amber-100 text-amber-800'
                            }`}>
                                <span className={`inline-flex h-2 w-2 rounded-full ${
                                    initialData.chatGptSubscriptionTransportEnabled ? 'bg-emerald-500' : 'bg-amber-500'
                                }`} />
                                {initialData.chatGptSubscriptionTransportEnabled
                                    ? 'Codex CLI transport enabled on this server'
                                    : 'Server transport flag is not enabled'}
                            </div>
                        </div>
                        <label className="flex items-center gap-2 text-sm">
                            <input
                                type="checkbox"
                                name="chatGptSubscriptionEnabled"
                                defaultChecked={initialData.chatGptSubscriptionEnabled}
                                className="h-4 w-4 rounded border-gray-300 text-amber-600"
                            />
                            Enable my ChatGPT subscription provider
                        </label>
                        <div className="space-y-2">
                            <Label htmlFor="chatGptSubscriptionAccessToken">Codex Access Token (optional)</Label>
                            <Input
                                id="chatGptSubscriptionAccessToken"
                                name="chatGptSubscriptionAccessToken"
                                type="password"
                                placeholder="optional for device-auth runner cache"
                            />
                            {initialData.hasChatGptSubscriptionAccessToken && (
                                <div className="flex items-center gap-2 text-xs text-emerald-700">
                                    <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                                    ChatGPT subscription access token is configured.
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="chatGptSubscriptionDefaultTextModel">Default subscription text model</Label>
                            <select
                                id="chatGptSubscriptionDefaultTextModel"
                                name="chatGptSubscriptionDefaultTextModel"
                                defaultValue={initialData.chatGptSubscriptionDefaultTextModel}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                {initialData.chatGptSubscriptionModels.map((model) => (
                                    <option key={model.value} value={model.value}>
                                        {model.label}
                                    </option>
                                ))}
                            </select>
                            <p className="text-[10px] text-muted-foreground">
                                Used for text-generation choices labeled ChatGPT Subscription. Requires server transport flag `CHATGPT_SUBSCRIPTION_TRANSPORT=codex_cli`.
                            </p>
                        </div>
                        <div className="rounded-md border border-amber-200 bg-white/70 p-3 text-xs text-slate-700">
                            <div className="font-medium text-slate-900">Device-auth setup</div>
                            <div className="mt-2 grid gap-2">
                                <div>
                                    <div className="text-[10px] uppercase text-muted-foreground">Enable server transport</div>
                                    <code className="block rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-50">
                                        {initialData.chatGptSubscriptionSetupGuide.transportEnvVar}={initialData.chatGptSubscriptionSetupGuide.requiredTransportValue}
                                    </code>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase text-muted-foreground">Interactive login on trusted runner</div>
                                    <code className="block rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-50">
                                        {initialData.chatGptSubscriptionSetupGuide.deviceAuthCommand}
                                    </code>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase text-muted-foreground">Check runner login</div>
                                    <code className="block rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-50">
                                        {initialData.chatGptSubscriptionSetupGuide.statusCommand}
                                    </code>
                                </div>
                                <div>
                                    <div className="text-[10px] uppercase text-muted-foreground">Non-interactive token login</div>
                                    <code className="block rounded bg-slate-900 px-2 py-1 text-[11px] text-slate-50">
                                        {initialData.chatGptSubscriptionSetupGuide.accessTokenCommand}
                                    </code>
                                </div>
                            </div>
                            <div className="mt-2 text-[10px] text-muted-foreground">
                                Codex path: {initialData.chatGptSubscriptionSetupGuide.codexCliPath}; working directory: {initialData.chatGptSubscriptionSetupGuide.codexCwd}
                            </div>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                            <input
                                type="checkbox"
                                name="clearChatGptSubscriptionAccessToken"
                                className="h-3.5 w-3.5 rounded border-gray-300 text-red-600"
                            />
                            Clear saved ChatGPT subscription access token
                        </label>
                        <div className="flex flex-col gap-2 border-t border-amber-200 pt-3 sm:flex-row sm:items-center sm:justify-between">
                            <div className="text-[10px] text-muted-foreground">
                                Test uses the saved token, deployment `CODEX_ACCESS_TOKEN`, or the trusted runner's Codex device-auth cache.
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={handleTestChatGptSubscription}
                                disabled={isTestingSubscription}
                                className="shrink-0"
                            >
                                {isTestingSubscription ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <PlugZap className="mr-2 h-4 w-4" />
                                )}
                                Test Subscription
                            </Button>
                        </div>
                        {subscriptionTestMessage && (
                            <div className={`rounded border px-3 py-2 text-xs ${
                                subscriptionTestOk
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-red-200 bg-red-50 text-red-700'
                            }`}>
                                {subscriptionTestMessage}
                            </div>
                        )}
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button type="submit" disabled={isPending}>
                            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {isPending ? 'Saving...' : 'Save Changes'}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
