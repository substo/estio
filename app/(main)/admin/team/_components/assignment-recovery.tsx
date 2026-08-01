'use client';

import { FormEvent, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  executeAssignmentRecovery,
  previewAssignmentRecovery,
  type AssignmentRecoveryExecuteResult,
  type AssignmentRecoveryPreviewResult,
} from '../actions';

export function AssignmentRecovery({ sourceEmail }: { sourceEmail: string }) {
  const [previewResult, setPreviewResult] = useState<AssignmentRecoveryPreviewResult | null>(null);
  const [executionResult, setExecutionResult] = useState<AssignmentRecoveryExecuteResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const preview = previewResult?.success ? previewResult.preview : null;

  async function buildPreview() {
    setLoading(true);
    setPreviewResult(await previewAssignmentRecovery({ sourceEmail }));
    setExecutionResult(null);
    setLoading(false);
  }

  async function execute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview?.confirmationToken) return;
    const form = new FormData(event.currentTarget);
    setExecuting(true);
    setExecutionResult(await executeAssignmentRecovery({
      confirmationToken: preview.confirmationToken,
      confirmationPhrase: String(form.get('confirmationPhrase') || ''),
      acknowledgeHistoricalPreservation: form.get('acknowledgeHistoricalPreservation') === 'on',
    }));
    setExecuting(false);
  }

  return (
    <Card className="border-blue-200" aria-label={`Assignment recovery for ${sourceEmail}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg"><RotateCcw className="h-5 w-5" /> Recover legacy assignments</CardTitle>
        <p className="text-sm text-muted-foreground">Assign all current location responsibilities to {sourceEmail}. Shared records and historical actors remain unchanged.</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button type="button" variant="outline" onClick={buildPreview} disabled={loading}>
          {loading ? 'Building preview…' : 'Preview assignment recovery'}
        </Button>
        {previewResult && !previewResult.success && <div role="alert" className="text-sm text-red-700">{previewResult.error}</div>}
        {preview && (
          <div className="space-y-4" aria-live="polite">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>{preview.counts.contacts} Contacts will be assigned in place.</li>
              <li>{preview.counts.inheritedConversations} Conversations will follow those Contacts without row updates.</li>
              <li>{preview.counts.deals} Deals will be assigned in place.</li>
              <li>{preview.counts.openTasks} open tasks will be assigned in place.</li>
              <li>{preview.counts.nonTerminalViewingSessions} non-terminal viewing sessions will be assigned in place.</li>
              <li>{preview.counts.futureActionableViewings} future actionable Viewings will be assigned in place.</li>
            </ul>
            <p className="text-sm">Unchanged: messages, ContactHistory, completed/past Viewings, creator/sender fields, Properties, Companies, Projects, and prospecting records.</p>
            {preview.confirmationToken ? (
              <form onSubmit={execute} className="space-y-3 rounded-md border border-red-300 bg-red-50 p-4">
                <p className="text-sm text-red-900">Type exactly: <code>{preview.confirmationPhrase}</code></p>
                <Input name="confirmationPhrase" required autoComplete="off" aria-label="Assignment recovery confirmation phrase" />
                <label className="flex items-start gap-2 text-sm text-red-900">
                  <input name="acknowledgeHistoricalPreservation" type="checkbox" required className="mt-1" />
                  <span>I confirm current assignments will change without copying records or rewriting historical actors.</span>
                </label>
                <Button type="submit" variant="destructive" disabled={executing} className="w-full">
                  {executing ? 'Assigning…' : `Assign all current responsibilities to ${sourceEmail}`}
                </Button>
              </form>
            ) : <div role="alert" className="text-sm text-amber-800">Recovery execution is not configured.</div>}
          </div>
        )}
        {executionResult && (
          <div role={executionResult.success ? 'status' : 'alert'} className="rounded-md border p-3 text-sm">
            {executionResult.success
              ? `Assignment recovery completed with audit ${executionResult.auditId}.${executionResult.externalErrors.length ? ` Follow-up required: ${executionResult.externalErrors.join('; ')}.` : ''}`
              : executionResult.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
