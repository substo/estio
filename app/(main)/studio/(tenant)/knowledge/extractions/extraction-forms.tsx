"use client";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {ExtractionInputs} from "@/lib/studio/knowledge-extraction";
import {useStudioCommand} from "../../../_components/use-studio-command";
export function ExtractionStartForm({workspaceId,source,inputs}:{workspaceId:string;source:ExtractionInputs["source"];inputs:ExtractionInputs["inputs"]}){
 const router=useRouter();const [choice,setChoice]=useState(0);const [start,setStart]=useState(0);const [count,setCount]=useState(2);const [focus,setFocus]=useState("");const [confirm,setConfirm]=useState(false);const [queued,setQueued]=useState(false);
 const command=useStudioCommand(`/studio/knowledge/extractions/api`);const input=inputs[choice];
 async function submit(event:React.FormEvent){event.preventDefault();if(!input||queued)return;
  const result=await command.run({action:"enqueue",requestId:crypto.randomUUID(),sourceId:source.id,expectedVersion:Number(source.version),mode:input.mode,inputId:input.inputId,startUnit:start,unitCount:count,focus,confirmPaid:confirm});
  if(result?.ok){setQueued(true);router.push(`/studio/knowledge/extractions/${result.data.reviewId}`);}
 }
 return <form onSubmit={submit} className="space-y-4 rounded-xl border p-5 text-sm"><fieldset disabled={command.pending||command.retry||queued} className="space-y-4">
  <label className="block space-y-1"><span>Saved input</span><select value={choice} onChange={e=>{setChoice(Number(e.target.value));setStart(0);}} className="block w-full rounded-md border bg-background p-2">{inputs.map((i,n)=><option key={`${i.mode}:${i.inputId}`} value={n}>{i.label} · {i.totalUnits} units</option>)}</select></label>
  <p className="text-muted-foreground">Saved text and upload transcripts use 2,000-character units. Imported units keep their original IDs and text; no visual/OCR interpretation occurs. Each request covers only your selected range. Up to 20 imported transcriptions and 20 completed uploads are listed.</p>
  <div className="flex flex-wrap gap-4"><label>First unit (zero-based)<input type="number" min={0} max={Math.max(0,(input?.totalUnits??1)-1)} required value={start} onChange={e=>setStart(Number(e.target.value))} className="ml-2 w-24 rounded-md border bg-background p-2"/></label>
  <label>Units to process<input type="number" min={1} max={8} required value={count} onChange={e=>setCount(Number(e.target.value))} className="ml-2 w-20 rounded-md border bg-background p-2"/></label></div>
  <label className="block space-y-1"><span>Topic focus (optional)</span><input maxLength={300} value={focus} onChange={e=>setFocus(e.target.value)} className="block w-full rounded-md border bg-background p-2"/></label>
  <p className="text-muted-foreground">Selected text is sent to OpenAI using the workspace key. The request reserves $0.01, settles metered usage afterward, and retains its hold if the outcome is uncertain. Oversized input ranges are rejected; select fewer units.</p>
  <label className="flex items-start gap-2"><input type="checkbox" required checked={confirm} onChange={e=>setConfirm(e.target.checked)}/><span>I am authorized to process this saved source text and authorize the paid extraction. Findings remain proposals until I separately add selected ones as pending knowledge.</span></label>
 </fieldset>
 <button disabled={command.pending||!input||queued} className="rounded-md border px-3 py-2 disabled:opacity-50">{command.pending?"Queuing…":command.retry?"Retry same request":"Extract proposed findings"}</button>
 {command.error?<p role="alert" className="text-destructive">{command.error}</p>:null}</form>;
}
export function ExtractionApplyForm({workspaceId,reviewId,version,available}:{workspaceId:string;reviewId:string;version:number;available:Array<{index:number;statement:string}>}){
 const router=useRouter();const [selected,setSelected]=useState<number[]>([]);const [confirm,setConfirm]=useState(false);const [saved,setSaved]=useState(false);
 const command=useStudioCommand(`/studio/knowledge/extractions/api`);
 async function submit(event:React.FormEvent){event.preventDefault();if(saved)return;
  const result=await command.run({action:"apply",requestId:crypto.randomUUID(),reviewId,expectedVersion:version,findingIndexes:selected,confirmPending:confirm});
  if(result?.ok){setSaved(true);router.refresh();}else if(result?.status===409)router.refresh();
 }
 if(saved)return <p role="status">Selected findings were added or linked to existing exact matches. Existing statuses and history are preserved.</p>;
 return <form onSubmit={submit} className="space-y-4 rounded-xl border p-5 text-sm"><fieldset disabled={command.pending||command.retry} className="space-y-3"><legend className="font-medium">Add selected findings for review</legend>
  {available.map(f=><label key={f.index} className="flex items-start gap-2"><input type="checkbox" checked={selected.includes(f.index)} onChange={e=>setSelected(s=>e.target.checked?[...s,f.index]:s.filter(i=>i!==f.index))}/>{f.statement}</label>)}
  <label className="flex items-start gap-2"><input type="checkbox" required checked={confirm} onChange={e=>setConfirm(e.target.checked)}/><span>I reviewed these proposals and confirm adding new findings as pending knowledge. Exact existing source/statement/kind matches are reused with their current statuses; no topics, approvals or existing findings are overwritten.</span></label>
 </fieldset><button disabled={command.pending||(!command.retry&&!selected.length)} className="rounded-md border px-3 py-2 disabled:opacity-50">{command.pending?"Adding…":command.retry?"Retry same application":"Add selected pending findings"}</button>
 {command.error?<p role="alert" className="text-destructive">{command.error}</p>:null}</form>;
}
