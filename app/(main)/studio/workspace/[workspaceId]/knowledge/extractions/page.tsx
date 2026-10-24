import Link from "next/link";
import {notFound} from "next/navigation";
import {listStudioTextRuns} from "@/lib/studio/idea-review";
export const dynamic="force-dynamic";
export default async function Extractions({params}:{params:Promise<{workspaceId:string}>}){
 const {workspaceId}=await params;const data=await listStudioTextRuns(workspaceId,"knowledge_extract");if(!data)notFound();
 return <main className="mx-auto max-w-4xl space-y-6 p-6 md:p-10"><Link href={`/studio/workspace/${workspaceId}/knowledge`} className="text-sm text-primary hover:underline">Knowledge</Link><h1 className="text-3xl font-semibold">Recent knowledge extractions</h1>
 <p className="text-muted-foreground">Open a saved research or content record to select its text or completed upload transcript. Each extraction covers only its selected range and produces reviewable proposals.</p>
 {data.reviews.map(r=><p key={r.id}><Link href={`/studio/workspace/${workspaceId}/knowledge/extractions/${r.id}`} className="text-primary hover:underline">{new Date(r.created_at).toLocaleString("en-GB",{timeZone:"Asia/Nicosia"})}</Link> · {r.completed_at?"Proposals saved":"View processing status"}</p>)}
 {!data.reviews.length?<p>No extraction runs yet.</p>:null}</main>;
}
