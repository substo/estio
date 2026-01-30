"use client";

import { Copy, Check, Globe, AlertTriangle, Info, CheckCircle2, XCircle, Loader2, ExternalLink } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

// Server IP where Caddy/Next.js is running
const SERVER_IP = "138.199.214.117";

interface DnsInstructionsProps {
    domain: string;
}

type VerificationStatus = "idle" | "checking" | "verified" | "cloudflare_detected" | "failed";

export function DnsInstructions({ domain }: DnsInstructionsProps) {
    const [copied, setCopied] = useState<string | null>(null);
    const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("idle");
    const [resolvedIp, setResolvedIp] = useState<string | null>(null);
    const [isCloudflare, setIsCloudflare] = useState(false);

    const copyToClipboard = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopied(id);
        setTimeout(() => setCopied(null), 2000);
    };

    // Helper to check if IP is Cloudflare
    const isCloudflareIp = (ip: string) => {
        return ip.startsWith("104.") ||    // 104.16.0.0/12
            ip.startsWith("172.64.") || ip.startsWith("172.65.") || ip.startsWith("172.66.") || ip.startsWith("172.67.") ||
            ip.startsWith("162.158.") || ip.startsWith("162.159.") ||
            ip.startsWith("188.114.") ||
            ip.startsWith("190.93.") ||
            ip.startsWith("197.234.") ||
            ip.startsWith("198.41.") ||
            ip.startsWith("141.101.") ||
            ip.startsWith("108.162.") ||
            ip.startsWith("173.245.") ||
            ip.startsWith("103.21.") || ip.startsWith("103.22.") || ip.startsWith("103.31.");
    };

    const checkDns = async () => {
        setVerificationStatus("checking");
        setIsCloudflare(false);

        try {
            // Step 1: Check DNS resolution
            const response = await fetch(`https://dns.google/resolve?name=${domain}&type=A`);
            const data = await response.json();

            if (!data.Answer || data.Answer.length === 0) {
                setResolvedIp(null);
                setVerificationStatus("failed");
                return;
            }

            const ip = data.Answer[0].data;
            setResolvedIp(ip);

            // Step 2: Check if it points to our server directly
            if (ip === SERVER_IP) {
                setVerificationStatus("verified");
                return;
            }

            // Step 3: Check if it's a Cloudflare IP - ask user to disable proxy for verification
            if (isCloudflareIp(ip)) {
                setIsCloudflare(true);
                setVerificationStatus("cloudflare_detected");
                return;
            }

            // IP doesn't match our server or Cloudflare
            setVerificationStatus("failed");
        } catch (error) {
            console.error("DNS check error:", error);
            setVerificationStatus("failed");
        }
    };

    const dnsRecords = [
        {
            id: "a-record",
            type: "A",
            name: "@",
            displayName: `@ (or ${domain})`,
            value: SERVER_IP,
            ttl: "Auto",
            required: true,
            description: "Points your root domain to our server. This is essential for your site to load.",
        },
        {
            id: "www-cname",
            type: "CNAME",
            name: "www",
            displayName: "www",
            value: domain,
            ttl: "Auto",
            required: false,
            description: "Redirects www.yourdomain.com to yourdomain.com (recommended).",
        },
    ];

    return (
        <Card className="border-2 border-dashed">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Globe className="h-5 w-5 text-primary" />
                        <CardTitle>DNS Configuration for {domain}</CardTitle>
                    </div>
                    {verificationStatus === "verified" && (
                        <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Verified
                        </Badge>
                    )}
                    {verificationStatus === "cloudflare_detected" && (
                        <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Cloudflare Detected
                        </Badge>
                    )}
                </div>
                <CardDescription>
                    Follow these steps to connect your domain. Your site will be live with automatic SSL once DNS is configured.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {/* Step 1: Access DNS Settings */}
                <div className="space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">1</span>
                        Access Your Domain's DNS Settings
                    </h3>
                    <p className="text-sm text-muted-foreground pl-8">
                        Log in to your domain registrar (e.g., <strong>Cloudflare</strong>, <strong>GoDaddy</strong>, <strong>Namecheap</strong>)
                        and navigate to the DNS management section for <strong>{domain}</strong>.
                    </p>
                </div>

                {/* Step 2: Add DNS Records */}
                <div className="space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">2</span>
                        Add/Update the Following DNS Records
                    </h3>

                    <div className="overflow-x-auto rounded-lg border ml-8">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr className="border-b">
                                    <th className="text-left py-3 px-4 font-medium">Type</th>
                                    <th className="text-left py-3 px-4 font-medium">Name/Host</th>
                                    <th className="text-left py-3 px-4 font-medium">Value/Points To</th>
                                    <th className="text-left py-3 px-4 font-medium">TTL</th>
                                    <th className="py-3 px-4"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {dnsRecords.map((record) => (
                                    <tr key={record.id} className="border-b last:border-0 hover:bg-muted/30">
                                        <td className="py-3 px-4">
                                            <span className="inline-flex items-center px-2.5 py-1 rounded-md bg-primary/10 text-primary font-mono text-xs font-semibold">
                                                {record.type}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4">
                                            <code className="bg-muted px-2 py-1 rounded text-xs">{record.displayName}</code>
                                            {record.required && (
                                                <span className="ml-2 text-xs text-red-500 font-medium">Required</span>
                                            )}
                                        </td>
                                        <td className="py-3 px-4">
                                            <code className="bg-muted px-2 py-1 rounded text-xs font-mono">{record.value}</code>
                                        </td>
                                        <td className="py-3 px-4 text-muted-foreground text-xs">
                                            {record.ttl}
                                        </td>
                                        <td className="py-3 px-4">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => copyToClipboard(record.value, record.id)}
                                                className="h-8 px-2"
                                            >
                                                {copied === record.id ? (
                                                    <Check className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <Copy className="h-4 w-4" />
                                                )}
                                            </Button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Step 3: Wait & Verify */}
                <div className="space-y-3">
                    <h3 className="font-semibold flex items-center gap-2">
                        <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary text-primary-foreground text-sm">3</span>
                        Verify Your Configuration
                    </h3>
                    <div className="pl-8 space-y-4">
                        <p className="text-sm text-muted-foreground">
                            After adding the DNS records, click below to verify. DNS changes typically take 5-15 minutes, but can take up to 48 hours.
                        </p>

                        <div className="flex items-center gap-3">
                            <Button
                                onClick={checkDns}
                                disabled={verificationStatus === "checking"}
                                variant={verificationStatus === "verified" ? "outline" : "default"}
                            >
                                {verificationStatus === "checking" ? (
                                    <>
                                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                        Checking...
                                    </>
                                ) : verificationStatus === "verified" ? (
                                    <>
                                        <CheckCircle2 className="h-4 w-4 mr-2" />
                                        Verified!
                                    </>
                                ) : verificationStatus === "cloudflare_detected" ? (
                                    <>
                                        <AlertTriangle className="h-4 w-4 mr-2" />
                                        Cloudflare Detected
                                    </>
                                ) : (
                                    "Verify DNS Configuration"
                                )}
                            </Button>

                            {verificationStatus === "verified" && (
                                <a
                                    href={`https://${domain}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm text-primary flex items-center gap-1 hover:underline"
                                >
                                    Visit your site <ExternalLink className="h-3 w-3" />
                                </a>
                            )}
                        </div>

                        {verificationStatus === "failed" && (
                            <Alert variant="destructive">
                                <XCircle className="h-4 w-4" />
                                <AlertTitle>DNS Not Configured Correctly</AlertTitle>
                                <AlertDescription>
                                    {resolvedIp ? (
                                        <>Your domain currently points to <code className="bg-muted px-1 rounded">{resolvedIp}</code> instead of <code className="bg-muted px-1 rounded">{SERVER_IP}</code>. Please update your A record.</>
                                    ) : (
                                        <>No A record found for {domain}. Please add the A record above and wait a few minutes before trying again.</>
                                    )}
                                </AlertDescription>
                            </Alert>
                        )}

                        {verificationStatus === "verified" && (
                            <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/20">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <AlertTitle className="text-green-800 dark:text-green-400">DNS Configured Successfully!</AlertTitle>
                                <AlertDescription className="text-green-700 dark:text-green-300">
                                    Your domain is pointing directly to our server. SSL will be automatically provisioned on first visit.
                                </AlertDescription>
                            </Alert>
                        )}

                        {verificationStatus === "cloudflare_detected" && (
                            <Alert className="border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/20">
                                <AlertTriangle className="h-4 w-4 text-orange-600" />
                                <AlertTitle className="text-orange-800 dark:text-orange-400">Cloudflare Proxy Detected</AlertTitle>
                                <AlertDescription className="text-orange-700 dark:text-orange-300">
                                    <p>We detected that your domain is using Cloudflare's proxy (orange cloud). We cannot verify if your A record points to the correct server.</p>

                                    <div className="mt-3 p-3 bg-orange-100 dark:bg-orange-900/30 rounded-md">
                                        <p className="font-semibold mb-2">To verify your configuration:</p>
                                        <ol className="list-decimal list-inside space-y-1 text-sm">
                                            <li>Go to your Cloudflare DNS settings</li>
                                            <li>Temporarily switch the A record proxy status to <strong>"DNS Only"</strong> (gray cloud)</li>
                                            <li>Click "Verify DNS Configuration" again</li>
                                            <li>Once verified, you can switch it back to <strong>"Proxied"</strong> (orange cloud)</li>
                                        </ol>
                                    </div>

                                    <p className="mt-3 text-sm">
                                        <strong>Tip:</strong> Make sure your A record value is set to <code className="bg-orange-200 dark:bg-orange-800 px-1 rounded">{SERVER_IP}</code>
                                    </p>
                                </AlertDescription>
                            </Alert>
                        )}
                    </div>
                </div>

                {/* Tips for Cloudflare Users */}
                <Alert className="bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800">
                    <AlertTriangle className="h-4 w-4 text-orange-600" />
                    <AlertTitle className="text-orange-800 dark:text-orange-400">Cloudflare Users</AlertTitle>
                    <AlertDescription className="text-orange-700 dark:text-orange-300">
                        <ul className="list-disc list-inside mt-2 space-y-1">
                            <li>Set the A record proxy status to <strong>"Proxied"</strong> (orange cloud) for caching & protection.</li>
                            <li>If you see SSL errors, try switching to <strong>"DNS Only"</strong> (gray cloud) temporarily.</li>
                            <li>Ensure your SSL/TLS mode is set to <strong>"Full"</strong> or <strong>"Full (Strict)"</strong>.</li>
                        </ul>
                    </AlertDescription>
                </Alert>

                {/* Need Help */}
                <div className="text-center pt-4 border-t">
                    <p className="text-sm text-muted-foreground">
                        Need help? Contact our support team or check the{" "}
                        <a href="/admin/help/dns-setup" className="text-primary hover:underline">DNS setup guide</a>.
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
