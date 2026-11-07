"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LegacyCredentialsSummary } from "@/lib/platform/legacy-credentials-http";

type State =
    | { kind: "plan"; summary: LegacyCredentialsSummary }
    | { kind: "pending"; summary: LegacyCredentialsSummary }
    | { kind: "done"; summary: LegacyCredentialsSummary }
    | { kind: "error"; summary: LegacyCredentialsSummary; message: string };

export function LegacyCredentialsCard({ summary }: { summary: LegacyCredentialsSummary }) {
    const [state, setState] = useState<State>({ kind: "plan", summary });

    async function apply() {
        setState({ kind: "pending", summary: state.summary });
        try {
            const response = await fetch("/api/platform/legacy-credentials", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            const body = await response.json().catch(() => null);
            if (body && typeof body.toMove === "number") {
                setState(response.ok
                    ? { kind: "done", summary: body }
                    : { kind: "error", summary: body, message: `${body.errors} item(s) could not be moved; their old copies were kept.` });
            } else {
                setState({ kind: "error", summary: state.summary, message: body?.error || "The move could not run." });
            }
        } catch {
            setState({ kind: "error", summary: state.summary, message: "The move could not run. Check the connection and try again." });
        }
    }

    const current = state.summary;
    const nothingLeft = current.toMove === 0;

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-base">Move remaining legacy credentials</CardTitle>
                <CardDescription>
                    Old copies outside the encrypted settings store. Apply stores each one encrypted, checks it, then clears the old copy.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
                {nothingLeft ? (
                    <p>Nothing left to move.{state.kind === "done" && current.written ? ` ${current.written} moved.` : ""}</p>
                ) : (
                    <ul className="space-y-1">
                        {current.groups.map((group) => (
                            <li key={group.label} className="flex justify-between gap-4">
                                <span>{group.label}</span>
                                <span className="tabular-nums text-muted-foreground">{group.count}</span>
                            </li>
                        ))}
                    </ul>
                )}
                {current.unreadable ? (
                    <p className="text-muted-foreground">{current.unreadable} Outlook value(s) cannot be decrypted and stay in place; that person reconnects Outlook.</p>
                ) : null}
                <div aria-live="polite" className="min-h-5">
                    {state.kind === "error" ? <p role="alert" className="text-destructive">{state.message}</p> : null}
                </div>
                {!nothingLeft ? (
                    <Button onClick={apply} disabled={state.kind === "pending"}>
                        {state.kind === "pending" ? "Applying…" : "Apply"}
                    </Button>
                ) : null}
            </CardContent>
        </Card>
    );
}
