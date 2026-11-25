"use client";

import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import { CONTENT_LEVELS, CONTENT_STAGES } from "@/lib/studio/content-policy";
import { saveContentAction } from "../(tenant)/content/actions";
import { initialScriptTemplateSelection, type ScriptTemplateOption } from "@/lib/studio/script-template-policy";
import { ScriptTemplateBeats } from "./script-template-beats";
import Link from "next/link";
import { reconcileBlocks } from "@/lib/studio/script-blocks";
import type { VoiceRow } from "@/lib/studio/voices/policy";
import { ScriptBlockEditor } from "./script-block-editor";

export function ContentRecordForm({ locationId, recordId, version, title = "", payload = {}, templateOptions = [],
  pinnedTemplateId, templateSelectionSaved, canSelectTemplate = false, visible = "all", voices = [], locked = false, scriptLock, scriptRevision, onScriptSaved, onScriptSaveState, onAskAboutBlock }:  {
  voices?: readonly VoiceRow[]; /** The piece is archived: the script is read-only. */ locked?: boolean;
  /** Which part the workspace shows. Every field stays mounted (hidden ones keep their values and are still submitted), so switching modes never loses an unsaved edit. */
  visible?: "all" | "script" | "details" | "none";
  scriptLock?: boolean;
  scriptRevision?: { version: number; text: string } | null;
  onScriptSaved?: (version: number) => void;
  onScriptSaveState?: (saved: boolean) => void;
  onAskAboutBlock?: React.ComponentProps<typeof ScriptBlockEditor>["onAskAboutBlock"];
  locationId: string; recordId: string; version: number; title?: string; payload?: Record<string, unknown>;
  templateOptions?: readonly ScriptTemplateOption[]; pinnedTemplateId?: string | null;
  templateSelectionSaved?: boolean; canSelectTemplate?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    ["title", "summary", "notes"].map((field) => [field, field === "title" ? title : typeof payload[field] === "string" ? payload[field] as string : ""]),
  ));
  const [stage, setStage] = useState(Object.hasOwn(payload, "stage") ? String(payload.stage ?? "") : "idea");
  const [level, setLevel] = useState(Object.hasOwn(payload, "level") ? String(payload.level ?? "") : "discover");
  const [pillar, setPillar] = useState(payload.pillar == null ? "" : String(payload.pillar));
  const [approved, setApproved] = useState(payload.approved === true);
  const [archived, setArchived] = useState(payload.archived === true);
  const [templateId, setTemplateId] = useState(() => canSelectTemplate
    ? initialScriptTemplateSelection({ pinnedId: pinnedTemplateId, selectionSaved: templateSelectionSaved, script: payload.script, options: templateOptions })
    : pinnedTemplateId ?? "unchanged");
  const selectedTemplate = templateOptions.find(template => template.id === templateId);
  // Autosave moves the version forward; the Save button must always use the newest one.
  const [liveVersion, setLiveVersion] = useState(version);
  const editorVersion = Math.max(version, scriptRevision?.version ?? 0);
  const initialBlocks = useMemo(() => reconcileBlocks(scriptRevision && scriptRevision.version >= version
    ? { ...payload, script: scriptRevision.text } : payload), [payload, scriptRevision, version]);
  const adoptVersion = useCallback((saved: number, savedHere = true) => { setLiveVersion(saved); if (savedHere) onScriptSaved?.(saved); }, [onScriptSaved]);
  useEffect(() => {
    if (!scriptRevision) return;
    setLiveVersion(current => Math.max(current, scriptRevision.version));
    setApproved(false);
    if (scriptRevision.text.trim()) setStage(current => current === "idea" ? "script" : current);
    else setStage(current => current === "script" ? "idea" : current);
  }, [scriptRevision]);
  const editorScript = scriptRevision && scriptRevision.version >= version
    ? scriptRevision.text : typeof payload.script === "string" ? payload.script : "";
  const initialVoiceId = typeof payload.voiceId === "string" ? payload.voiceId : "";
  const [blocksJson, setBlocksJson] = useState(() => JSON.stringify({ version: 1, blocks: initialBlocks }));
  const [voiceId, setVoiceId] = useState(initialVoiceId);
  const onBlocksChange = useCallback((json: string, voice: string) => { setBlocksJson(json); setVoiceId(voice); }, []);
  const [state, action, pending] = useActionState(saveContentAction.bind(null, locationId, recordId, liveVersion), {});
  const inputClass = "mt-1 w-full rounded-md border bg-background p-3 text-sm";
  return (
    <form action={action} hidden={visible === "none"} className="space-y-5 rounded-xl border bg-card p-6">
      <div hidden={visible === "script"} className="space-y-5">
      <label className="block text-sm font-medium">Title<input name="title" value={values.title} required maxLength={180} onChange={(event) => setValues({ ...values, title: event.target.value })} className={inputClass} /></label>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm font-medium">Content stage<select name="stage" value={stage} onChange={(event) => setStage(event.target.value)} className={inputClass}>
          {!CONTENT_STAGES.includes(stage as typeof CONTENT_STAGES[number]) ? <option value={stage}>Unrecognized: {stage}</option> : null}
          {CONTENT_STAGES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </select></label>
        <label className="text-sm font-medium">Audience stage<select name="level" value={level} onChange={(event) => setLevel(event.target.value)} className={inputClass}>
          {!CONTENT_LEVELS.includes(level as typeof CONTENT_LEVELS[number]) ? <option value={level}>Unrecognized: {level}</option> : null}
          {CONTENT_LEVELS.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
        </select></label>
        <label className="text-sm font-medium">Content pillar<select name="pillar" value={pillar} onChange={(event) => setPillar(event.target.value)} className={inputClass}>
          <option value="">Not set</option>{!["", "1", "2", "3", "4"].includes(pillar) ? <option value={pillar}>Unrecognized: {pillar}</option> : null}
          {[1, 2, 3, 4].map((value) => <option key={value} value={value}>Pillar {value}</option>)}
        </select></label>
      </div>
      </div>
      <div hidden={visible === "details"} className="space-y-4">
          {selectedTemplate || canSelectTemplate ? <div className="space-y-2">
            {canSelectTemplate && templateOptions.length ? <label className="block text-sm font-medium">
              Script template
              <select name="scriptTemplateVersion" value={templateId} onChange={event => setTemplateId(event.target.value)} className={inputClass}>
                {templateId === "unchanged" ? <option value="unchanged">Choose a template (optional)</option> : null}
                <option value="">No template</option>
                {templateOptions.map(template => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}
              </select>
            </label> : canSelectTemplate ? <p className="text-sm text-muted-foreground">No approved templates yet. <Link className="text-primary hover:underline" href="/studio/content/templates">Browse script templates</Link></p> : null}
            {selectedTemplate ? <details className="space-y-2">
              <summary className="cursor-pointer text-sm font-medium">{canSelectTemplate ? "View template beats" : `${selectedTemplate.name} · v${selectedTemplate.version}`}</summary>
              <p className="break-words text-sm text-muted-foreground">{selectedTemplate.purpose}</p>
              <ScriptTemplateBeats beats={selectedTemplate.beats} />
            </details> : null}
          </div> : null}
        <fieldset disabled={scriptLock} className="min-w-0">
        <ScriptBlockEditor key={scriptRevision?.version} locationId={locationId} recordId={recordId} version={editorVersion} savedScript={editorScript} initialBlocks={initialBlocks} voices={voices} initialVoiceId={initialVoiceId}
          archived={locked} onVersion={adoptVersion} onBlocksChange={onBlocksChange} onSaveState={onScriptSaveState} onAskAboutBlock={onAskAboutBlock} />
        </fieldset>
        <input type="hidden" name="scriptBlocks" value={blocksJson} /><input type="hidden" name="voiceId" value={voiceId} />
      </div>
      {[{ name: "summary", label: "Idea summary", rows: 3 }, { name: "notes", label: "Production notes", rows: 6 }].map(({ name, label, rows }) => (
        <div key={name} hidden={visible === "script"} className="space-y-3">
          <label className="block text-sm font-medium">{label}<textarea name={name} rows={rows} value={values[name]} maxLength={name === "script" ? 100_000 : 20_000} onChange={(event) => setValues({ ...values, [name]: event.target.value })} className={inputClass} /></label>
        </div>
      ))}
      <input type="hidden" name="approvedPresent" value="1" /><input type="hidden" name="archivedPresent" value="1" />
      <div hidden={visible === "script"} className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input name="approved" type="checkbox" checked={approved} onChange={(event) => setApproved(event.target.checked)} />Reviewed and approved</label>
        <label className="flex items-center gap-2"><input name="archived" type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />Archived</label>
      </div>
      <p className="text-xs text-muted-foreground">Saved source links and attachments stay linked when you edit this piece. Ready marks work for review.</p>
      {state.error ? <p role="alert" className="text-sm text-destructive">{state.error}</p> : null}
      <button disabled={pending || scriptLock} type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{pending ? "Saving…" : "Save content piece"}</button>
    </form>
  );
}
