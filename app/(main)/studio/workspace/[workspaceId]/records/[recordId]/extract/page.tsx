import Link from "next/link";
import {notFound} from "next/navigation";
import {getKnowledgeExtractionInputs} from "@/lib/studio/knowledge-extraction";
import {ExtractionStartForm} from "../../../knowledge/extractions/extraction-forms";
export const dynamic="force-dynamic";
export default async function StartExtraction({params}:{params:Promise<{workspaceId:string;recordId:string}>}){
 const {workspaceId,recordId}=await params;const data=await getKnowledgeExtractionInputs(workspaceId,recordId);if(!data)notFound();
 return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><header className="space-y-2"><Link href={`/studio/workspace/${workspaceId}/knowledge/extractions`} className="text-sm text-primary hover:underline">Knowledge extractions</Link>
 <h1 className="text-3xl font-semibold">Extract knowledge: {data.source.title}</h1><p className="text-muted-foreground">Choose an authorized saved-text range. Proposals cite exact supplied units and quotes, and are added as pending findings only after a separate review action.</p></header>
 {data.inputs.length?<ExtractionStartForm workspaceId={workspaceId} source={data.source} inputs={data.inputs}/>:<p>Save source text, import source units or complete an authorized upload transcription before extracting knowledge.</p>}
 </main>;
}
