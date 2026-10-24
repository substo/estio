"use client";
import {useRef,useState} from "react";
/** Stable command replay after an uncertain transport/5xx outcome. */
export function useStudioCommand(endpoint:string){
 const commandRef=useRef<Record<string,unknown>|null>(null);const active=useRef(false);
 const [pending,setPending]=useState(false);const [retry,setRetry]=useState(false);const [error,setError]=useState<string|null>(null);
 async function run(command:Record<string,unknown>){
  if(active.current)return null;active.current=true;setPending(true);setError(null);commandRef.current??=command;setRetry(true);
  try{
   const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(commandRef.current),signal:AbortSignal.timeout(30000)});
   const data=await response.json();
   if(!response.ok){if(response.status<500){commandRef.current=null;setRetry(false);}setError(typeof data.error==="string"?data.error:"Command could not complete.");return {ok:false,status:response.status,data};}
   commandRef.current=null;setRetry(false);return {ok:true,status:response.status,data};
  }catch{setError("The outcome is unconfirmed. Retry the same command or reload to check the saved state.");return null;}
  finally{active.current=false;setPending(false);}
 }
 return {run,pending,retry,error};
}
