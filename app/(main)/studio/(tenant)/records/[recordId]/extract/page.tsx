import { studioRouteParams } from "@/lib/studio/route-context";
import Link from "next/link";
import {notFound} from "next/navigation";
import {getKnowledgeExtractionInputs, getLatestKnowledgeOutline} from "@/lib/studio/knowledge-extraction";
import {ExtractionStartForm} from "../../../knowledge/extractions/extraction-forms";
export const dynamic="force-dynamic";
export default async function StartExtraction({params}:{params: Promise<{ recordId:string }>}){
 const {locationId,recordId}=await studioRouteParams(params);const data=await getKnowledgeExtractionInputs(locationId,recordId);if(!data)notFound();
 const latest = await getLatestKnowledgeOutline(locationId,recordId);
 return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><header className="space-y-2"><Link href={`/studio/knowledge/extractions`} className="text-sm text-primary hover:underline">Knowledge extractions</Link>
 <h1 className="text-3xl font-semibold">Extract knowledge: {data.source.title}</h1><p className="text-muted-foreground">Turn saved source evidence into topics and cited takeaways you can review.</p></header>
 {latest ? <Link className="block text-primary underline" href={`/studio/knowledge/extractions/${latest.id}`}>Open latest knowledge review</Link> : null}
 {data.inputs.length?<ExtractionStartForm source={data.source} inputs={data.inputs}/>:<p>Save source text, import source units or complete an authorized upload transcription before extracting knowledge.</p>}
 </main>;
}
