'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { brandOnboardingQuestions } from '@/lib/studio/brand-onboarding-script';
import { brandProfileInputSchema, type BrandProfileInput } from '@/lib/brand-profile/schema';
const empty: BrandProfileInput = { answers: {}, sources: [], profile: { summary: '', audience: '', offer: '', tone: '', useWords: [], avoidWords: [], pillars: [] }, scriptVersion: 'v1' };
export function BrandOnboarding({ locationId, initial, resume, canManage, paidReady, youtubeConnected, remainingMicros }: { locationId: string; initial: BrandProfileInput | null; resume: {reviewId:string|null;requestId:string;excerpts:Array<{url:string;title:string;text:string}>}|null; canManage: boolean; paidReady: boolean; youtubeConnected: boolean; remainingMicros: number }) {
    const storageKey = `studio-onboarding:${locationId}`;
    const [input, setInput] = useState<BrandProfileInput>(initial || empty);
    const [step, setStep] = useState(initial ? 3 : 0);
    const [url, setUrl] = useState('');
    const [excerpts, setExcerpts] = useState<Array<{ url: string; title: string; text: string }>>(resume?.excerpts || []);
    const [reviewId, setReviewId] = useState<string | null>(resume?.reviewId || null);
    const [requestId, setRequestId] = useState<string | null>(resume?.requestId || null);
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    useEffect(() => { if (!canManage) return; try { const saved = localStorage.getItem(storageKey); if (saved && !resume) { const draft = JSON.parse(saved); setInput(brandProfileInputSchema.parse(draft.input)); setExcerpts(draft.excerpts || []); setReviewId(draft.reviewId || null); setRequestId(draft.requestId || null); } } catch { setMessage('Saved browser progress could not be read. You can start again.'); } }, [storageKey, canManage, resume]);
    useEffect(() => { if (canManage) { try { localStorage.setItem(storageKey, JSON.stringify({ input, excerpts, reviewId, requestId })); } catch { /* Form remains usable if browser storage is unavailable. */ } } }, [input, excerpts, reviewId, requestId, storageKey, canManage]);
    async function command(body: unknown) {
        const response = await fetch('/api/studio/brand-profile', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Tenant': locationId }, body: JSON.stringify(body) });
        const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Try again.'); return data;
    }
    async function run(action: () => Promise<void>) { setBusy(true); setMessage(''); try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Try again.'); } finally { setBusy(false); } }
    useEffect(() => { if (!reviewId || !canManage) return; let cancelled = false;
        const poll = async () => { try { const response = await fetch(`/api/studio/brand-profile?reviewId=${reviewId}`, { headers: { 'X-Studio-Tenant': locationId } }); const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Could not load draft.'); if (cancelled) return;
            if (data.review?.result) { setInput(value => ({ ...value, profile: data.review.result })); setReviewId(null); setRequestId(null); setStep(3); setMessage('Draft ready. Review every field before saving.'); }
            else if (['failed','cancelled'].includes(data.review?.status)) setMessage(data.review.last_error_message || 'Draft stopped. Review the job in Jobs before retrying.');
        } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : 'Draft status unavailable.'); } };
        void poll(); const timer = setInterval(poll, 5000); return () => { cancelled = true; clearInterval(timer); };
    }, [reviewId, locationId, canManage]);
    if (!canManage) return <section className="space-y-3"><p>Only an admin can update this profile.</p>{initial ? Object.entries(initial.profile).map(([key,value]) => <p key={key}><strong>{key}: </strong>{Array.isArray(value) ? value.join(', ') : value}</p>) : <p>Your team has not saved a profile yet.</p>}</section>;
    return <section className="space-y-5">
        <p className="text-sm text-muted-foreground">Step {step+1} of 4 · Answers and page look-ups are free. AI drafting requires your confirmation.</p>
        {step===0 && <div className="space-y-4">{brandOnboardingQuestions.map(([id,label]) => <label className="block space-y-2" key={id}><span>{label}</span><Textarea maxLength={4000} value={input.answers[id] || ''} onChange={event => setInput({ ...input, answers: { ...input.answers, [id]: event.target.value } })} /></label>)}</div>}
        {step===1 && <div className="space-y-4"><p>Add up to three public websites or profiles. Only checked sources will be used.</p><Input aria-label="Public website URL" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com" /><Button disabled={busy || excerpts.length>=3} onClick={() => run(async () => { const { page } = await command({ action: 'lookup', url }); const sourceUrl = page.url || url; setExcerpts([...excerpts, { url: sourceUrl, title: (page.title || '').slice(0,500), text: (page.text || page.excerpt || '').slice(0,3000) }]); setInput({ ...input, sources: [...input.sources.filter(source=>source.url!==sourceUrl), { url: sourceUrl, fetchedAt: new Date().toISOString() }].slice(0,10) }); })}>Look up page</Button>
            {excerpts.map(page=><label key={page.url} className="block rounded border p-3"><input type="checkbox" checked={input.sources.some(source=>source.url===page.url)} onChange={event => setInput({ ...input, sources: event.target.checked ? [...input.sources,{url:page.url,fetchedAt:new Date().toISOString()}] : input.sources.filter(source=>source.url!==page.url) })} /> {page.title || page.url}<span className="block text-sm"><input type="checkbox" checked={Boolean(input.sources.find(source=>source.url===page.url)?.platform)} onChange={event=>setInput({...input,sources:input.sources.map(source=>source.url===page.url?{...source,platform:event.target.checked?new URL(page.url).hostname:undefined}:source)})} /> Save as a public social profile link</span><p className="text-sm text-muted-foreground">{page.text}</p></label>)}
            <p>YouTube: {youtubeConnected ? "Connected" : "Not connected"}</p><Link className="block underline" href="/account/connections" target="_blank">Open your YouTube connections</Link><p className="text-sm">You can skip connecting. Other platforms use public profile links for now.</p></div>}
        {step===2 && <div className="space-y-4"><p>Draft a profile from your answers and checked sources. Review it before saving.</p><p className="text-sm">Estimated hold: $0.01 · Available budget: ${(remainingMicros/1000000).toFixed(2)}</p>{!paidReady && <p>Add an OpenAI key and available budget in <Link className="underline" href="/studio/settings/ai">AI settings</Link>.</p>}
            <Button disabled={busy || !paidReady || Boolean(reviewId)} onClick={() => run(async () => { const id = requestId || crypto.randomUUID(); setRequestId(id); const data = await command({ action:'enqueue', requestId:id, confirmPaid:true, input, excerpts:excerpts.filter(page=>input.sources.some(source=>source.url===page.url)) }); setReviewId(data.reviewId); setMessage('Draft queued. You can leave and resume in this browser.'); })}>Confirm paid draft</Button>{reviewId && <Link className="block underline" href="/studio/jobs">View queued draft in Jobs</Link>}</div>}
        {step===3 && <div className="space-y-4">{Object.entries(input.profile).map(([key,value])=><label className="block space-y-2" key={key}><span className="capitalize">{key}</span><Textarea value={Array.isArray(value)?value.join('\n'):value} onChange={event => setInput({...input,profile:{...input.profile,[key]:Array.isArray(value)?event.target.value.split('\n').filter(Boolean):event.target.value}})} /></label>)}<Button disabled={busy} onClick={()=>run(async()=>{await command({action:'save',input}); localStorage.removeItem(storageKey); setMessage('Profile saved for this business. CRM drafts use its brand voice.');})}>Save reviewed profile</Button></div>}
        {message && <p role="status" className="rounded border p-3 text-sm">{message}</p>}
        <div className="flex gap-3"><Button variant="outline" disabled={busy || step===0} onClick={()=>setStep(step-1)}>Back</Button>{step<3 && <Button disabled={busy} onClick={()=>setStep(step+1)}>Continue</Button>}</div>
    </section>;
}
