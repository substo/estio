'use client';

import { FormEvent, useState } from 'react';
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { previewTransferResponsibilities, type OffboardingPreviewResult } from '../actions';
export function OffboardingPreview() {
    const [result, setResult] = useState<OffboardingPreviewResult | null>(null);
    const [loading, setLoading] = useState(false);
    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLoading(true);
        const form = new FormData(event.currentTarget);
        setResult(await previewTransferResponsibilities({
            sourceEmail: String(form.get('sourceEmail') || ''),
            successorEmail: String(form.get('successorEmail') || ''),
        }));
        setLoading(false);
    }
    const preview = result?.success ? result.preview : null;
    return (
        <Card className="mb-6 border-amber-200" aria-labelledby="offboarding-preview-title">
            <CardHeader>
                <CardTitle id="offboarding-preview-title" className="flex items-center gap-2 text-lg">
                    <ShieldCheck className="h-5 w-5" /> Transfer responsibilities and deactivate
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                    Read-only preview. No records, memberships, credentials, or provider accounts will be changed.
                </p>
            </CardHeader>
            <CardContent className="space-y-5">
                <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
                    <div className="space-y-2">
                        <Label htmlFor="sourceEmail">User to retire</Label>
                        <Input id="sourceEmail" name="sourceEmail" type="email" autoComplete="off" required />
                    </div>
                    <ArrowRight className="mb-2 hidden h-5 w-5 text-muted-foreground md:block" aria-hidden="true" />
                    <div className="space-y-2">
                        <Label htmlFor="successorEmail">Successor</Label>
                        <Input id="successorEmail" name="successorEmail" type="email" autoComplete="off" required />
                    </div>
                    <Button type="submit" disabled={loading}>{loading ? 'Building preview…' : 'Preview transfer'}</Button>
                </form>
                {result && !result.success && (
                    <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        {result.error}
                    </div>
                )}

                {preview && (
                    <div className="space-y-5" aria-live="polite">
                        <div className="rounded-md bg-muted p-3 text-sm">
                            <div className="font-medium">{preview.activeLocation.name || 'Unnamed location'} <span className="font-mono text-xs">({preview.activeLocation.id})</span></div>
                            <div className="mt-2 grid gap-2 md:grid-cols-2">
                                {[preview.source, preview.successor].map((user, index) => (
                                    <div key={user.id}>
                                        <span className="font-medium">{index === 0 ? 'Source' : 'Successor'}:</span> {user.email}<br />
                                        <span className="font-mono text-xs">User {user.id} · Clerk {user.clerkId}</span>
                                        <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                                            {user.memberships.map((membership) => (
                                                <li key={membership.locationId}>
                                                    {membership.locationName || membership.locationId}: {membership.role || 'missing role'}{membership.connected ? '' : ' (disconnected)'}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <section aria-labelledby="would-transfer-heading">
                                <h3 id="would-transfer-heading" className="font-semibold">Would transfer in later slices</h3>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                    <li>{preview.counts.assignedContacts} assigned contacts; {preview.counts.inheritedConversations} conversations follow contact access</li>
                                    <li>{preview.counts.openTasks} open tasks</li>
                                    <li>{preview.counts.nonTerminalViewingSessions} non-terminal viewing sessions</li>
                                </ul>
                            </section>
                            <section aria-labelledby="unchanged-heading">
                                <h3 id="unchanged-heading" className="font-semibold">Would remain unchanged</h3>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                    {preview.unchangedShared.map((item) => <li key={item.label}>{item.label}: {item.count}</li>)}
                                    {preview.preservedAttribution.map((item) => <li key={item.label}>{item.label}: {item.count} preserved</li>)}
                                </ul>
                            </section>
                        </div>

                        <section aria-labelledby="private-state-heading">
                            <h3 id="private-state-heading" className="font-semibold">Private state — never transferred</h3>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                {preview.privateState.map((item) => (
                                    <li key={item.label}>{item.label}: {item.configured ? 'configured' : 'not detected'} — {item.disposition}</li>
                                ))}
                            </ul>
                        </section>

                        <section aria-labelledby="ambiguous-heading">
                            <h3 id="ambiguous-heading" className="font-semibold">Blocked or explicitly unchanged</h3>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                {preview.ambiguous.map((item) => (
                                    <li key={item.label}>{item.label}: {item.count} — {item.reason}</li>
                                ))}
                            </ul>
                        </section>

                        {preview.blockingConditions.length > 0 && (
                            <section className="rounded-md border border-amber-300 bg-amber-50 p-3" aria-labelledby="blocking-heading">
                                <h3 id="blocking-heading" className="flex items-center gap-2 font-semibold text-amber-900">
                                    <AlertTriangle className="h-4 w-4" /> Blocking conditions
                                </h3>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                                    {preview.blockingConditions.map((condition) => <li key={condition}>{condition}</li>)}
                                </ul>
                            </section>
                        )}

                        <Button type="button" variant="destructive" disabled className="w-full">
                            Execution unavailable until ownership Slices 3–5 are complete and explicitly confirmed
                        </Button>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
