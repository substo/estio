'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { RESET_ANALYTICS_CONFIRMATION, type AnalyticsDeletedCounts, type ResetAnalyticsResult } from '@/lib/analytics/reset';
import { resetAnalytics } from './actions';

const initialState: ResetAnalyticsResult = { success: false, message: '', deletedCounts: null };

function SubmitButton({ confirmed }: { confirmed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={!confirmed || pending} aria-disabled={!confirmed || pending}>
      {pending ? 'Resetting analytics…' : 'Permanently reset analytics'}
    </Button>
  );
}

export function ResetAnalyticsCard({ counts }: { counts: AnalyticsDeletedCounts }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [state, formAction, pending] = useActionState(resetAnalytics, initialState);
  const confirmed = confirmation === RESET_ANALYTICS_CONFIRMATION;

  useEffect(() => {
    if (state.success) {
      setOpen(false);
      setConfirmation('');
    }
  }, [state.success]);

  return (
    <section className="rounded-lg border border-red-300 bg-red-50 p-4" aria-labelledby="analytics-data-heading">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 id="analytics-data-heading" className="text-lg font-semibold text-red-950">Analytics data</h2>
          <p className="mt-1 text-sm text-red-900">Deletes visitor, session, event, and reporting history for this location.</p>
          <p className="mt-1 text-sm text-red-900">Analytics collection resumes immediately, so new activity may appear after the reset.</p>
        </div>
        <AlertDialog open={open} onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (!next) setConfirmation('');
        }}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">Reset analytics</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently reset analytics?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletion cannot be undone. It removes analytics visitors, sessions, events, and daily reporting history only for your active location. Collection resumes immediately.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <form action={formAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="reset-analytics-confirmation">Type <span className="font-mono">{RESET_ANALYTICS_CONFIRMATION}</span> to confirm</Label>
                <Input
                  id="reset-analytics-confirmation"
                  name="confirmation"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  autoComplete="off"
                  autoFocus
                  disabled={pending}
                  aria-describedby="reset-analytics-help"
                />
                <p id="reset-analytics-help" className="text-xs text-muted-foreground">The phrase must match exactly.</p>
              </div>
              {!state.success && state.message ? <p role="alert" aria-live="assertive" className="text-sm text-destructive">{state.message}</p> : null}
              <AlertDialogFooter>
                <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                <SubmitButton confirmed={confirmed} />
              </AlertDialogFooter>
            </form>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <dl className="mt-4 grid gap-2 sm:grid-cols-4" aria-label="Current analytics record counts">
        {([
          ['Visitors', counts.visitors],
          ['Sessions', counts.sessions],
          ['Events', counts.events],
          ['Daily rollups', counts.dailyRollups],
        ] as const).map(([label, count]) => (
          <div key={label} className="rounded-md border border-red-200 bg-white p-3">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono text-lg font-semibold">{count.toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      {state.success ? <p role="status" aria-live="polite" className="mt-4 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-950">{state.message}</p> : null}
    </section>
  );
}
