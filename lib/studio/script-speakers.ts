export const MAX_SCRIPT_SPEAKER = 60;

export function scriptSpeaker(value: string) {
  const name = value.replace(/[\[\]\r\n\u0000]/g, "").trim();
  return name.length <= MAX_SCRIPT_SPEAKER ? name : "";
}

const legacyRole = /^(HOST|GUEST(?: \d+)?|NARRATOR|PRESENTER|INTERVIEWER|INTERVIEWEE|VOICE[ -]?OVER|VO)(?:\s*:([\s\S]*))?$/;

/** Explicit speaker cues plus the bare/colon-prefixed role labels used by older generated scripts. */
export function readSpeakerCue(line: string) {
  const explicit = /^\[Speaker:\s*([^\]]+)\]\s*(.*)$/i.exec(line.trim());
  const role = explicit ?? legacyRole.exec(line.trim());
  const speaker = scriptSpeaker(role?.[1] ?? "");
  return speaker ? { speaker, text: (role?.[2] ?? "").trim() } : null;
}

export function withoutSpeakerCues(text: string) {
  return text.split(/\r?\n/).map(line => readSpeakerCue(line)?.text ?? line).join("\n");
}
