"use client";
import { StudioTextProviderChoice } from "../../../_components/text-provider-choice";
import type { StudioTextProvider } from "@/lib/studio/text-provider";
import {useState} from "react";
import {useRouter} from "next/navigation";
import type {ExtractionInputs} from "@/lib/studio/knowledge-extraction";
import {useStudioCommand} from "../../../_components/use-studio-command";
export function ExtractionStartForm({ source, inputs }: { source: ExtractionInputs["source"]; inputs: ExtractionInputs["inputs"] }) {
  const [provider, setProvider] = useState<StudioTextProvider>("subscription");
  const [choice, setChoice] = useState(0);
  const [confirm, setConfirm] = useState(false);
  const [queued, setQueued] = useState(false);
  const router = useRouter();
  const command = useStudioCommand("/studio/knowledge/extractions/api");
  const input = inputs[choice];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!input || queued) return;
    const result = await command.run({ action: "enqueueOutline", requestId: crypto.randomUUID(),
      sourceId: source.id, expectedVersion: Number(source.version), inputId: input.inputId, mode: input.mode,
      provider, confirmPaid: provider === "openai" && confirm, confirmSubscription: provider === "subscription" && confirm });
    if (result?.ok) {
      setQueued(true);
      router.push(`/studio/knowledge/extractions/${result.data.outlineId}`);
    }
  }

  return <form onSubmit={submit} className="space-y-4 rounded-xl border p-5 text-sm">
    <fieldset disabled={command.pending || command.retry || queued} className="space-y-4">
      <label className="block space-y-1">Saved evidence<select value={choice} onChange={e => setChoice(Number(e.target.value))}
        className="block w-full rounded-md border bg-background p-2">
        {inputs.map((item, index) => <option key={`${item.mode}:${item.inputId}`} value={index}>{item.label}</option>)}
      </select></label>
      <p className="text-muted-foreground">Studio reads the entire selected input and brings the takeaways together in one review.</p>
      <StudioTextProviderChoice fullSource provider={provider} onChange={value => { setProvider(value); setConfirm(false); }} />
      <label className="flex items-start gap-2">
        <input type="checkbox" required checked={confirm} onChange={e => setConfirm(e.target.checked)} />
        <span>{provider === "openai"
          ? "I authorize paid processing of this input using the Location OpenAI API, with up to $0.48 in batch reservations."
          : "I authorize processing of this input using my paired Mac subscription."}</span>
      </label>
    </fieldset>
    <button disabled={command.pending || !input || queued} className="rounded-md border px-3 py-2 disabled:opacity-50">
      {command.pending ? "Queuing…" : command.retry ? "Retry same request" : "Extract knowledge"}
    </button>
    {command.error ? <p role="alert" className="text-destructive">{command.error}</p> : null}
  </form>;
}
export function ExtractionApplyForm({locationId,reviewId,version,available}:{locationId:string;reviewId:string;version:number;available:Array<{index:number;statement:string}>}){
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
