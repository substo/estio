'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { Building2, Loader2 } from 'lucide-react';
import {
  applyProspectCompanyLink,
  getProspectCompanyLinkOptions,
  type ProspectCompanyLinkOptionsResponse,
} from '../actions';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

interface CompanyLinkDialogProps {
  prospectId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLinked?: (result: { companyId: string; companyName: string }) => void;
}

type SelectionMode = 'existing' | 'create';

interface CreateFormState {
  name: string;
  website: string;
  phone: string;
  email: string;
}

const emptyCreateForm: CreateFormState = {
  name: '',
  website: '',
  phone: '',
  email: '',
};

function normalizeFormValue(value: string): string | null {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

export function CompanyLinkDialog({ prospectId, open, onOpenChange, onLinked }: CompanyLinkDialogProps) {
  const [isLoadingOptions, startLoadingOptions] = useTransition();
  const [isApplying, startApplying] = useTransition();
  const [options, setOptions] = useState<ProspectCompanyLinkOptionsResponse | null>(null);
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('existing');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [createForm, setCreateForm] = useState<CreateFormState>(emptyCreateForm);
  const [inlineError, setInlineError] = useState<string | null>(null);

  const topCandidate = options?.candidates?.[0] || null;
  const hasSingleHighConfidence = useMemo(
    () => Boolean(topCandidate && options?.candidates.length === 1 && topCandidate.confidence >= 0.9),
    [topCandidate, options?.candidates.length]
  );

  useEffect(() => {
    if (!open) return;
    if (!prospectId) {
      setOptions(null);
      setInlineError('No prospect selected.');
      return;
    }

    setInlineError(null);
    startLoadingOptions(async () => {
      const response = await getProspectCompanyLinkOptions(prospectId);
      setOptions(response);

      const defaultName = response.agencyProfile?.name || '';
      setCreateForm({
        name: defaultName,
        website: response.agencyProfile?.website || '',
        phone: response.agencyProfile?.phone || '',
        email: response.agencyProfile?.email || '',
      });

      if (response.linkable && response.candidates.length > 0) {
        setSelectionMode('existing');
        setSelectedCompanyId(response.suggestedCompanyId || response.candidates[0]!.companyId);
      } else {
        setSelectionMode('create');
        setSelectedCompanyId(null);
      }
    });
  }, [open, prospectId]);

  const canSubmit = useMemo(() => {
    if (!prospectId || !options?.linkable || isLoadingOptions || isApplying) return false;
    if (selectionMode === 'existing') return Boolean(selectedCompanyId);
    return Boolean(createForm.name.trim());
  }, [prospectId, options?.linkable, isLoadingOptions, isApplying, selectionMode, selectedCompanyId, createForm.name]);

  const handleSubmit = () => {
    if (!prospectId) {
      setInlineError('No prospect selected.');
      return;
    }
    if (!options?.linkable) {
      setInlineError(options?.reason || 'This prospect cannot be linked right now.');
      return;
    }

    setInlineError(null);
    startApplying(async () => {
      const payload = selectionMode === 'existing'
        ? { mode: 'existing' as const, companyId: String(selectedCompanyId || '') }
        : {
            mode: 'create' as const,
            profileOverrides: {
              name: normalizeFormValue(createForm.name),
              website: normalizeFormValue(createForm.website),
              phone: normalizeFormValue(createForm.phone),
              email: normalizeFormValue(createForm.email),
            },
          };

      const result = await applyProspectCompanyLink(prospectId, payload);

      if (!result.success) {
        setInlineError(result.message || 'Failed to link company.');
        return;
      }

      if (!result.companyId || !result.companyName) {
        setInlineError('Linking succeeded but returned incomplete company data. Please refresh and retry.');
        return;
      }

      toast.success(result.message || 'Company linked');
      onLinked?.({ companyId: result.companyId, companyName: result.companyName });
      onOpenChange(false);
    });
  };

  const renderCandidates = () => {
    if (!options || options.candidates.length === 0) return null;

    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">Candidate Companies</Label>
          {hasSingleHighConfidence && (
            <Badge variant="default" className="text-[10px]">
              High confidence
            </Badge>
          )}
        </div>

        <RadioGroup
          value={selectedCompanyId || ''}
          onValueChange={(value) => {
            setSelectedCompanyId(value);
            setSelectionMode('existing');
            setInlineError(null);
          }}
          className="space-y-2"
        >
          {options.candidates.map((candidate) => (
            <Label
              key={candidate.companyId}
              className="flex cursor-pointer items-start gap-2 rounded-md border p-2.5 hover:bg-muted/30"
            >
              <RadioGroupItem value={candidate.companyId} className="mt-0.5" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium leading-tight">{candidate.name}</span>
                  <span className="text-[11px] text-muted-foreground">{Math.round(candidate.confidence * 100)}%</span>
                </div>
                <div className="text-[11px] text-muted-foreground">{candidate.evidence.join(' · ')}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {[candidate.website, candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'No extra details'}
                </div>
              </div>
            </Label>
          ))}
        </RadioGroup>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-emerald-600" /> Link Prospect To Company
          </DialogTitle>
          <DialogDescription>
            Review matches and confirm whether to link to an existing company or create a new one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isLoadingOptions ? (
            <div className="flex items-center gap-2 rounded-md border p-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading company options...
            </div>
          ) : !options ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              Could not load link options.
            </div>
          ) : !options.linkable ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {options.reason || options.message || 'This prospect cannot be linked right now.'}
            </div>
          ) : (
            <>
              {options.candidates.length > 0 ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant={selectionMode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectionMode('existing');
                      setInlineError(null);
                    }}
                  >
                    Use Existing
                  </Button>
                  <Button
                    type="button"
                    variant={selectionMode === 'create' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => {
                      setSelectionMode('create');
                      setInlineError(null);
                    }}
                  >
                    Create New
                  </Button>
                </div>
              ) : (
                <Badge variant="outline" className="w-fit text-xs">No plausible matches found</Badge>
              )}

              {(selectionMode === 'existing' || (options.candidates.length > 0 && hasSingleHighConfidence)) && renderCandidates()}

              {(selectionMode === 'create' || options.candidates.length === 0) && (
                <div className="space-y-2 rounded-md border p-3">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">Create Company</Label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Company name</Label>
                      <Input
                        value={createForm.name}
                        onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))}
                        placeholder="Agency name"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Website</Label>
                      <Input
                        value={createForm.website}
                        onChange={(event) => setCreateForm((prev) => ({ ...prev, website: event.target.value }))}
                        placeholder="example.com"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input
                        value={createForm.phone}
                        onChange={(event) => setCreateForm((prev) => ({ ...prev, phone: event.target.value }))}
                        placeholder="+357..."
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs">Email</Label>
                      <Input
                        value={createForm.email}
                        onChange={(event) => setCreateForm((prev) => ({ ...prev, email: event.target.value }))}
                        placeholder="agency@example.com"
                      />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {inlineError && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
              {inlineError}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {isApplying ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="h-4 w-4 animate-spin" /> Linking...
              </span>
            ) : selectionMode === 'create' ? 'Create & Link' : 'Link Company'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
