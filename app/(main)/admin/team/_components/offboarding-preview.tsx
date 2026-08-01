'use client';

import { FormEvent, useState } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { executeTransferResponsibilities, previewTransferResponsibilities, type ExecuteOffboardingResult, type OffboardingPreviewResult } from '../actions';
export function OffboardingPreview() {
    const [mode, setMode] = useState<'TRANSFER' | 'KEEP_ASSIGNED'>('TRANSFER');
    const [result, setResult] = useState<OffboardingPreviewResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [executionResult, setExecutionResult] = useState<ExecuteOffboardingResult | null>(null);
    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLoading(true);
        const form = new FormData(event.currentTarget);
        setResult(await previewTransferResponsibilities({
            sourceEmail: String(form.get('sourceEmail') || ''),
            successorEmail: String(form.get('successorEmail') || ''),
            mode,
            suspendClerkGlobally: form.get('suspendClerkGlobally') === 'on',
        }));
        setExecutionResult(null);
        setLoading(false);
    }
    async function handleExecute(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!preview?.confirmationToken) return;
        setExecuting(true);
        const form = new FormData(event.currentTarget);
        setExecutionResult(await executeTransferResponsibilities({
            confirmationToken: preview.confirmationToken,
            confirmationPhrase: String(form.get('confirmationPhrase') || ''),
            acknowledgeNoHistoricalRewrite: form.get('acknowledgeNoHistoricalRewrite') === 'on',
        }));
        setExecuting(false);
    }
    const preview = result?.success ? result.preview : null;
    return (
        <Card className="mb-6 border-amber-200" aria-labelledby="offboarding-preview-title">
            <CardHeader>
                <CardTitle id="offboarding-preview-title" className="flex items-center gap-2 text-lg">
                    <ShieldCheck className="h-5 w-5" /> Remove location access
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                    Read-only preview. No records, memberships, credentials, or provider accounts will be changed.
                </p>
            </CardHeader>
            <CardContent className="space-y-5">
                <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
                    <fieldset className="space-y-2 md:col-span-2">
                        <legend className="text-sm font-medium">Responsibility handling</legend>
                        <label className="flex items-start gap-2 text-sm">
                            <input type="radio" name="mode" value="TRANSFER" checked={mode === 'TRANSFER'} onChange={() => setMode('TRANSFER')} />
                            <span><strong>Transfer</strong> — reassign active responsibilities to an exact successor.</span>
                        </label>
                        <label className="flex items-start gap-2 text-sm">
                            <input type="radio" name="mode" value="KEEP_ASSIGNED" checked={mode === 'KEEP_ASSIGNED'} onChange={() => setMode('KEEP_ASSIGNED')} />
                            <span><strong>Keep assigned</strong> — retain assignments on the inactive User; do not rewrite responsibility records.</span>
                        </label>
                    </fieldset>
                    <div className="space-y-2">
                        <Label htmlFor="sourceEmail">User to retire</Label>
                        <Input id="sourceEmail" name="sourceEmail" type="email" autoComplete="off" required />
                    </div>
                    <div className="space-y-2" aria-hidden={mode !== 'TRANSFER'}>
                        <Label htmlFor="successorEmail">Successor</Label>
                        <Input id="successorEmail" name="successorEmail" type="email" autoComplete="off" required={mode === 'TRANSFER'} disabled={mode !== 'TRANSFER'} />
                    </div>
                    <label className="flex items-start gap-2 rounded-md border p-3 text-sm md:col-span-2">
                        <input name="suspendClerkGlobally" type="checkbox" className="mt-1" />
                        <span><strong>Globally retire identity</strong> — also revoke Clerk sessions and ban the Clerk user. This is separate from removing access to this location and is unavailable when another membership exists.</span>
                    </label>
                    <Button type="submit" disabled={loading} className="md:col-span-2">{loading ? 'Building preview…' : 'Preview offboarding'}</Button>
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
                                {[preview.source, ...(preview.successor ? [preview.successor] : [])].map((user, index) => (
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
                                <h3 id="would-transfer-heading" className="font-semibold">
                                    {preview.mode === 'TRANSFER' ? 'Will transfer on confirmation' : 'Will remain assigned to the inactive user'}
                                </h3>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                    <li>{preview.counts.assignedContacts} assigned contacts; {preview.counts.inheritedConversations} conversations follow contact access</li>
                                    <li>{preview.counts.activeAssignedDeals} active assigned deals</li>
                                    <li>{preview.counts.openTasks} open tasks</li>
                                    <li>{preview.counts.nonTerminalViewingSessions} non-terminal viewing sessions</li>
                                    <li>{preview.counts.futureActionableViewings} future, non-terminal viewings; completed viewing attribution remains unchanged</li>
                                </ul>
                            </section>
                            <section aria-labelledby="unchanged-heading">
                                <h3 id="unchanged-heading" className="font-semibold">Will remain unchanged</h3>
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

                        <section className="rounded-md border p-3 text-sm" aria-label="Access removal scope">
                            <p><strong>Location access:</strong> Will remove access to {preview.activeLocation.name || 'this location'} while retaining the local User row, email, and historical attribution.</p>
                            <p className="mt-1"><strong>Global identity:</strong> {preview.suspendClerkGlobally ? 'Will revoke Clerk sessions and ban the Clerk user after local removal.' : 'Will not revoke Clerk sessions or ban the Clerk user.'}</p>
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

                        {preview.confirmationToken && preview.blockingConditions.length === 0 ? (
                            <form onSubmit={handleExecute} className="space-y-4 rounded-md border border-red-300 bg-red-50 p-4" aria-labelledby="execute-offboarding-heading">
                                <h3 id="execute-offboarding-heading" className="font-semibold text-red-900">Explicit final confirmation</h3>
                                <p className="text-sm text-red-900">Type exactly: <code>{preview.confirmationPhrase}</code></p>
                                <Input name="confirmationPhrase" required autoComplete="off" aria-label="Offboarding confirmation phrase" />
                                <label className="flex items-start gap-2 text-sm text-red-900">
                                    <input name="acknowledgeNoHistoricalRewrite" type="checkbox" required className="mt-1" />
                                    <span>{preview.mode === 'TRANSFER'
                                        ? 'I confirm active responsibilities will transfer without rewriting historical actors or duplicating records.'
                                        : 'I confirm responsibility assignments will remain on the retained inactive User without copying or rewriting records.'}</span>
                                </label>
                                <Button type="submit" variant="destructive" disabled={executing} className="w-full">
                                    {executing ? 'Executing…' : 'Remove access to this location'}
                                </Button>
                            </form>
                        ) : (
                            <Button type="button" variant="destructive" disabled className="w-full">
                                Execution blocked until every condition above is resolved
                            </Button>
                        )}

                        {executionResult && (
                            <div role={executionResult.success ? 'status' : 'alert'} aria-live="assertive" className="rounded-md border p-3 text-sm">
                                {executionResult.success
                                    ? `Local offboarding completed with audit ${executionResult.auditId}. ${executionResult.externalErrors.length ? `External cleanup requires attention: ${executionResult.externalErrors.join('; ')}.` : 'External cleanup completed without reported warnings.'}`
                                    : executionResult.error}
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
