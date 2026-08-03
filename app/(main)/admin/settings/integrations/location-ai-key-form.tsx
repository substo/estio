"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AiProviderActionState } from "./ai-provider-actions";

export function LocationAiKeyForm({
    provider,
    hasKey,
    action,
}: {
    provider: "Gemini" | "OpenAI API";
    hasKey: boolean;
    action: (state: AiProviderActionState, data: FormData) => Promise<AiProviderActionState>;
}) {
    const [state, formAction, pending] = useActionState(action, {});
    return (
        <form action={formAction} className="space-y-5">
            <div className="space-y-2">
                <Label htmlFor="apiKey">{hasKey ? `Replace ${provider} key` : `${provider} key`}</Label>
                <Input id="apiKey" name="apiKey" type="password" autoComplete="off" placeholder={hasKey ? "Enter a new key to replace the saved connection" : "Paste the key here"} className="min-h-11" />
                <p className="text-sm text-muted-foreground">The saved key is encrypted and is never returned to your browser.</p>
            </div>
            <div className="flex flex-wrap gap-3">
                <Button name="operation" value="save" disabled={pending} className="min-h-11">{hasKey ? "Replace and test" : "Save and test"}</Button>
                {hasKey && <Button name="operation" value="test" variant="outline" disabled={pending} className="min-h-11">Test connection</Button>}
                {hasKey && (
                    <Button
                        name="operation"
                        value="remove"
                        variant="destructive"
                        disabled={pending}
                        className="min-h-11"
                        onClick={(event) => {
                            if (!window.confirm(`Remove the saved ${provider} connection?`)) event.preventDefault();
                        }}
                    >
                        Remove
                    </Button>
                )}
            </div>
            <div aria-live="polite" role="status" className={state.error ? "text-sm text-destructive" : "text-sm text-emerald-700"}>
                {state.error || state.message}
            </div>
        </form>
    );
}
