'use client';

import { FormEvent, useId, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    executeTransferResponsibilities,
    previewTransferResponsibilities,
    type ExecuteOffboardingResult,
    type OffboardingPreviewResult,
} from '../actions';

type MemberOption = { id: string; email: string; name: string };

type RemoveUserDialogProps = {
    source: MemberOption;
    activeLocation: { id: string; name: string | null };
    members: MemberOption[];
    hasOtherMembership: boolean;
};

export function RemoveUserDialog({ source, activeLocation, members, hasOtherMembership }: RemoveUserDialogProps) {
    const router = useRouter();
    const fieldId = useId();
    const titleRef = useRef<HTMLHeadingElement>(null);
    const successors = members.filter((member) => member.id !== source.id);
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<'TRANSFER' | 'KEEP_ASSIGNED'>('TRANSFER');
    const [successorUserId, setSuccessorUserId] = useState(successors[0]?.id || '');
    const [suspendClerkGlobally, setSuspendClerkGlobally] = useState(false);
    const [result, setResult] = useState<OffboardingPreviewResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [executing, setExecuting] = useState(false);
    const [executionResult, setExecutionResult] = useState<ExecuteOffboardingResult | null>(null);

    const preview = result?.success ? result.preview : null;
    const invalidatePreview = () => {
        setResult(null);
        setExecutionResult(null);
    };

    async function handlePreview(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setLoading(true);
        setExecutionResult(null);
        try {
            setResult(await previewTransferResponsibilities({
                sourceUserId: source.id,
                successorUserId: mode === 'TRANSFER' ? successorUserId : undefined,
                mode,
                suspendClerkGlobally,
            }));
        } catch {
            setResult({ success: false, error: 'Unable to build the removal preview' });
        } finally {
            setLoading(false);
        }
    }

    async function handleExecute(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!preview?.confirmationToken) return;
        setExecuting(true);
        try {
            const form = new FormData(event.currentTarget);
            const execution = await executeTransferResponsibilities({
                confirmationToken: preview.confirmationToken,
                confirmationPhrase: String(form.get('confirmationPhrase') || ''),
                acknowledgeNoHistoricalRewrite: form.get('acknowledgeNoHistoricalRewrite') === 'on',
            });
            setExecutionResult(execution);
            if (execution.success) {
                const query = new URLSearchParams({ removalAudit: execution.auditId });
                if (execution.externalErrors.length) query.set('cleanupWarning', '1');
                router.replace(`/admin/team?${query.toString()}`);
                router.refresh();
            }
        } catch {
            setExecutionResult({ success: false, error: 'Removal could not be completed' });
        } finally {
            setExecuting(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => {
            if (!nextOpen && (loading || executing)) return;
            setOpen(nextOpen);
        }}>
            <DialogTrigger asChild>
                <Button type="button" variant="destructive" size="sm">
                    <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                    Remove from location
                </Button>
            </DialogTrigger>
            <DialogContent
                className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
                aria-busy={loading || executing}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    titleRef.current?.focus();
                }}
            >
                <DialogHeader>
                    <DialogTitle ref={titleRef} tabIndex={-1}>Remove from location</DialogTitle>
                    <DialogDescription>
                        Remove this member&apos;s access to the active location without deleting their User identity or rewriting history.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-3 rounded-md border bg-muted/40 p-3 text-sm sm:grid-cols-2">
                    <div><span className="font-medium">Selected user</span><br />{source.name}<br /><span className="text-muted-foreground">{source.email}</span></div>
                    <div><span className="font-medium">Active location</span><br />{activeLocation.name || 'Unnamed location'}</div>
                </div>

                <form onSubmit={handlePreview} className="space-y-5">
                    <fieldset className="space-y-3" disabled={loading || executing}>
                        <legend className="text-sm font-medium">Active responsibility handling</legend>
                        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                            <input
                                type="radio"
                                name={`mode-${fieldId}`}
                                value="TRANSFER"
                                checked={mode === 'TRANSFER'}
                                onChange={() => { setMode('TRANSFER'); invalidatePreview(); }}
                                className="mt-1"
                            />
                            <span><strong>Transfer active work</strong> <span className="text-muted-foreground">(recommended)</span><br />Move active responsibilities in place to a successor. Conversation access follows transferred contacts.</span>
                        </label>
                        <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
                            <input
                                type="radio"
                                name={`mode-${fieldId}`}
                                value="KEEP_ASSIGNED"
                                checked={mode === 'KEEP_ASSIGNED'}
                                onChange={() => { setMode('KEEP_ASSIGNED'); invalidatePreview(); }}
                                className="mt-1"
                            />
                            <span><strong>Leave assigned to inactive user</strong> <span className="text-muted-foreground">(advanced)</span><br />Keep responsibility rows unchanged for later use with Assignment Recovery.</span>
                        </label>
                    </fieldset>

                    {mode === 'TRANSFER' && (
                        <div className="space-y-2">
                            <Label htmlFor={`${fieldId}-successor`}>Successor</Label>
                            <select
                                id={`${fieldId}-successor`}
                                value={successorUserId}
                                onChange={(event) => { setSuccessorUserId(event.target.value); invalidatePreview(); }}
                                required
                                disabled={loading || executing}
                                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <option value="" disabled>Select an active member</option>
                                {successors.map((member) => <option key={member.id} value={member.id}>{member.name} — {member.email}</option>)}
                            </select>
                            <p className="text-xs text-muted-foreground">Only active members of this location are available.</p>
                        </div>
                    )}

                    <div className="rounded-md border p-3">
                        <label className="flex items-start gap-3 text-sm" htmlFor={`${fieldId}-retire`}>
                            <input
                                id={`${fieldId}-retire`}
                                type="checkbox"
                                checked={suspendClerkGlobally}
                                disabled={hasOtherMembership || loading || executing}
                                onChange={(event) => { setSuspendClerkGlobally(event.target.checked); invalidatePreview(); }}
                                className="mt-1"
                            />
                            <span><strong>Retire global login</strong><br />Separately revoke Clerk sessions and ban this login after local removal. This does not delete the local User.</span>
                        </label>
                        <p className="mt-2 text-xs text-muted-foreground">
                            {hasOtherMembership ? 'Unavailable because this user has another location membership.' : 'Optional and unchecked by default.'}
                        </p>
                    </div>

                    <Button type="submit" disabled={loading || executing || (mode === 'TRANSFER' && !successorUserId)} className="w-full">
                        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {loading ? 'Generating read-only preview…' : 'Generate removal preview'}
                    </Button>
                </form>

                {result && !result.success && <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">{result.error}</div>}

                {preview && (
                    <div className="space-y-5" aria-live="polite">
                        <section aria-labelledby={`${fieldId}-work-summary`}>
                            <h3 id={`${fieldId}-work-summary`} className="font-semibold">
                                {preview.mode === 'TRANSFER' ? 'Active work to transfer' : 'Active work left assigned'}
                            </h3>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                <li>{preview.counts.assignedContacts} assigned contacts; {preview.counts.inheritedConversations} inherited conversations follow contact access</li>
                                <li>{preview.counts.activeAssignedDeals} active deals</li>
                                <li>{preview.counts.openTasks} open tasks</li>
                                <li>{preview.counts.nonTerminalViewingSessions} non-terminal viewing sessions</li>
                                <li>{preview.counts.futureActionableViewings} future actionable viewings</li>
                            </ul>
                        </section>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <section aria-labelledby={`${fieldId}-unchanged`}>
                                <h3 id={`${fieldId}-unchanged`} className="font-semibold">Shared records unchanged</h3>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                    {preview.unchangedShared.map((item) => <li key={item.label}>{item.label}: {item.count}</li>)}
                                </ul>
                            </section>
                            <section aria-labelledby={`${fieldId}-history`}>
                                <h3 id={`${fieldId}-history`} className="font-semibold">Historical attribution preserved</h3>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                    {preview.preservedAttribution.map((item) => <li key={item.label}>{item.label}: {item.count}</li>)}
                                </ul>
                            </section>
                        </div>

                        <section aria-labelledby={`${fieldId}-private`}>
                            <h3 id={`${fieldId}-private`} className="font-semibold">Private state is never transferred</h3>
                            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                                {preview.privateState.map((item) => <li key={item.label}>{item.label}: {item.disposition}</li>)}
                            </ul>
                        </section>

                        {preview.blockingConditions.length > 0 ? (
                            <section className="rounded-md border border-amber-300 bg-amber-50 p-3" aria-labelledby={`${fieldId}-blocking`}>
                                <h3 id={`${fieldId}-blocking`} className="flex items-center gap-2 font-semibold text-amber-950"><AlertTriangle className="h-4 w-4" aria-hidden="true" />Blocking conditions</h3>
                                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">
                                    {preview.blockingConditions.map((condition) => <li key={condition}>{condition}</li>)}
                                </ul>
                            </section>
                        ) : <p className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">No blocking conditions were found.</p>}

                        <details className="rounded-md border p-3 text-sm">
                            <summary className="cursor-pointer font-medium">View details</summary>
                            <div className="mt-3 space-y-3">
                                <p>Location ID: <span className="font-mono text-xs">{preview.activeLocation.id}</span></p>
                                {[preview.source, ...(preview.successor ? [preview.successor] : [])].map((user, index) => (
                                    <div key={user.id}>
                                        <strong>{index === 0 ? 'Source' : 'Successor'}:</strong> {user.email}<br />
                                        <span className="font-mono text-xs">User {user.id} · Clerk {user.clerkId}</span>
                                    </div>
                                ))}
                                <ul className="list-disc space-y-1 pl-5">
                                    {preview.ambiguous.map((item) => <li key={item.label}>{item.label}: {item.count} — {item.reason}</li>)}
                                </ul>
                            </div>
                        </details>

                        {preview.confirmationToken && preview.blockingConditions.length === 0 ? (
                            <form onSubmit={handleExecute} className="space-y-4 rounded-md border border-red-300 bg-red-50 p-4" aria-labelledby={`${fieldId}-confirmation`}>
                                <h3 id={`${fieldId}-confirmation`} className="font-semibold text-red-950">Explicit final confirmation</h3>
                                <p className="text-sm text-red-950">Type exactly: <code>{preview.confirmationPhrase}</code></p>
                                <Label htmlFor={`${fieldId}-phrase`} className="text-red-950">Confirmation phrase</Label>
                                <Input id={`${fieldId}-phrase`} name="confirmationPhrase" required autoComplete="off" disabled={executing} />
                                <label className="flex items-start gap-3 text-sm text-red-950">
                                    <input name="acknowledgeNoHistoricalRewrite" type="checkbox" required disabled={executing} className="mt-1" />
                                    <span>{preview.mode === 'TRANSFER'
                                        ? 'I confirm active responsibilities will transfer without rewriting historical actors or duplicating records.'
                                        : 'I confirm assignments will remain on the retained inactive User without copying or rewriting records.'}</span>
                                </label>
                                <Button type="submit" variant="destructive" disabled={executing} className="w-full">
                                    {executing && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                                    {executing ? 'Removing access…' : 'Remove from location'}
                                </Button>
                            </form>
                        ) : (
                            <Button type="button" variant="destructive" disabled className="w-full">Execution blocked until every condition is resolved</Button>
                        )}

                        {executionResult && (
                            <div role={executionResult.success ? 'status' : 'alert'} aria-live="assertive" className="rounded-md border p-3 text-sm">
                                {executionResult.success
                                    ? `Location access was removed. Audit ID: ${executionResult.auditId}. ${executionResult.externalErrors.length ? 'External cleanup requires attention; local removal remains successful.' : 'No external cleanup warnings were reported.'}`
                                    : executionResult.error}
                            </div>
                        )}
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}
