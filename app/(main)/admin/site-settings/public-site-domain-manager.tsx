"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, ExternalLink, Globe2, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type ManagedDomain = {
    id: string;
    hostname: string;
    role: "CANONICAL" | "REDIRECT";
    status: "PENDING" | "VERIFIED" | "ACTIVE" | "RELEASED";
    verificationToken: string;
    provisioningError: string | null;
    verifiedAt: string | null;
    activatedAt: string | null;
};

async function readPayload(response: Response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Domain operation failed.");
    return payload;
}

export function PublicSiteDomainManager({
    locationId,
    initialDomains,
}: {
    locationId: string;
    initialDomains: ManagedDomain[];
}) {
    const [domains, setDomains] = useState(initialDomains);
    const [hostname, setHostname] = useState("");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [copied, setCopied] = useState<string | null>(null);
    const canonical = useMemo(() => domains.find((item) => item.role === "CANONICAL" && item.status === "ACTIVE"), [domains]);

    const copy = async (value: string, key: string) => {
        await navigator.clipboard.writeText(value);
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
    };

    const claim = async () => {
        if (!hostname.trim()) return;
        setBusyId("claim");
        try {
            const payload = await readPayload(await fetch("/api/admin/public-site-domains", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ locationId, hostname }),
            }));
            setDomains((current) => [...current.filter((item) => item.id !== payload.domain.id), payload.domain]);
            setHostname("");
            toast.success("Domain claimed. Add the TXT and routing records, then verify it.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not claim domain.");
        } finally {
            setBusyId(null);
        }
    };

    const refreshDomains = async () => {
        const response = await fetch(`/api/admin/public-site-domains?locationId=${encodeURIComponent(locationId)}`);
        if (response.ok) setDomains((await response.json()).domains || []);
    };

    const runAction = async (domain: ManagedDomain, action: "verify" | "retry") => {
        setBusyId(domain.id);
        try {
            const payload = await readPayload(await fetch(`/api/admin/public-site-domains/${domain.id}/${action}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ locationId }),
            }));
            if (payload.domains) setDomains(payload.domains);
            toast.success(action === "verify" ? "Verification completed." : "Provisioning completed.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Domain operation failed.");
            await refreshDomains();
        } finally {
            setBusyId(null);
        }
    };

    const release = async (domain: ManagedDomain) => {
        const confirmation = window.prompt(`Type RELEASE to stop serving ${domain.hostname}. Existing links will break.`);
        if (confirmation !== "RELEASE") return;
        setBusyId(domain.id);
        try {
            const payload = await readPayload(await fetch(`/api/admin/public-site-domains/${domain.id}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ locationId, confirmation }),
            }));
            setDomains(payload.domains || []);
            toast.success("Domain released.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not release domain.");
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Card className="rounded-lg">
            <CardHeader>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-lg"><Globe2 className="h-5 w-5" /> Public domains</CardTitle>
                        <CardDescription>Verify a replacement before switching. Previous domains remain redirect aliases until explicitly released.</CardDescription>
                    </div>
                    {canonical && <Badge variant="secondary"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Active</Badge>}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                        value={hostname}
                        onChange={(event) => setHostname(event.target.value)}
                        placeholder="properties.example.com"
                        aria-label="New public hostname"
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); claim(); } }}
                    />
                    <Button type="button" onClick={claim} disabled={busyId !== null || !hostname.trim()}>
                        {busyId === "claim" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Add domain
                    </Button>
                </div>

                {!canonical && domains.length === 0 && (
                    <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>No active domain</AlertTitle><AlertDescription>Add and verify a hostname to publish this site.</AlertDescription></Alert>
                )}

                <div className="divide-y rounded-md border">
                    {domains.map((domain) => {
                        const pending = domain.status === "PENDING";
                        const working = busyId === domain.id;
                        const txtName = `_estio-verification.${domain.hostname}`;
                        return (
                            <div key={domain.id} className="space-y-3 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="break-all text-sm font-medium">{domain.hostname}</span>
                                            <Badge variant={domain.role === "CANONICAL" ? "default" : "outline"}>{domain.role === "CANONICAL" ? "Canonical" : "Redirect"}</Badge>
                                            <Badge variant="secondary">{domain.status.toLowerCase()}</Badge>
                                        </div>
                                        {domain.role === "REDIRECT" && canonical && <p className="mt-1 text-xs text-muted-foreground">Redirects to {canonical.hostname}, preserving path and query.</p>}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {domain.status === "ACTIVE" && <Button size="icon" variant="ghost" asChild title="Open domain"><a href={`https://${domain.hostname}`} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a></Button>}
                                        {pending && <Button type="button" size="sm" onClick={() => runAction(domain, "verify")} disabled={working}>{working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />} Verify</Button>}
                                        {domain.provisioningError && domain.status === "VERIFIED" && <Button type="button" size="sm" variant="outline" onClick={() => runAction(domain, "retry")} disabled={working}>{working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />} Retry</Button>}
                                        {domain.role === "REDIRECT" && <Button type="button" size="icon" variant="ghost" title="Release domain" onClick={() => release(domain)} disabled={working}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                                    </div>
                                </div>
                                {pending && (
                                    <div className="grid gap-2 rounded-md bg-muted/50 p-3 text-xs">
                                        <div className="grid gap-1 sm:grid-cols-[90px_1fr_auto]"><span className="font-medium">TXT name</span><code className="break-all">{txtName}</code><Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(txtName, `${domain.id}:name`)}>{copied === `${domain.id}:name` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
                                        <div className="grid gap-1 sm:grid-cols-[90px_1fr_auto]"><span className="font-medium">TXT value</span><code className="break-all">{domain.verificationToken}</code><Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => copy(domain.verificationToken, `${domain.id}:value`)}>{copied === `${domain.id}:value` ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}</Button></div>
                                        <div className="grid gap-1 sm:grid-cols-[90px_1fr]"><span className="font-medium">Routing</span><span>Point A/AAAA to Estio or configure a CNAME through your DNS provider.</span></div>
                                    </div>
                                )}
                                {domain.provisioningError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertDescription>{domain.provisioningError}</AlertDescription></Alert>}
                            </div>
                        );
                    })}
                </div>
            </CardContent>
        </Card>
    );
}
