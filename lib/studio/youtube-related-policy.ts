import { youtubeVideoId } from "../google/youtube-policy";

const filler = new Set("a an and are as at be by can for from has have how i if in is it my of on or our that the this to was we what when which will with you your".split(" "));
const words = (value: string) => (value.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu) ?? []).filter(word => word.length <= 40);
const topicalWords = (value: string) => words(value).filter(word => !filler.has(word.toLowerCase()) && /\p{L}/u.test(word));

export function relatedYoutubeQueries(title: string, context: string) {
  const titleWords = words(title.replace(/https?:\/\/\S+|\S+@\S+/gi, " "));
  const frequencies = new Map<string, { text: string; count: number }>();
  for (const word of topicalWords(context.slice(0, 2400).replace(/https?:\/\/\S+|\S+@\S+/gi, " "))) {
    const key = word.toLowerCase();
    const entry = frequencies.get(key);
    if (entry) entry.count++;
    else frequencies.set(key, { text: word, count: 1 });
  }
  const keywords = [...frequencies.values()].sort((a, b) => b.count - a.count).map(entry => entry.text);
  const main = titleWords.slice(0, 12).join(" ");
  const titleKeywords = topicalWords(main);
  const titleSet = new Set(titleKeywords.map(word => word.toLowerCase()));
  const extra = keywords.filter(word => !titleSet.has(word.toLowerCase()));
  const focused = [...titleKeywords.slice(0, 6), ...extra.slice(0, 3)].join(" ");
  const queries = [focused || main, main]
    .map(query => query.slice(0, 160).trim()).filter(Boolean);
  return [...new Set(queries)];
}

export function relatedYoutubeSourceId(url: string | null) {
  try { return url ? youtubeVideoId(url) : null; } catch { return null; }
}

export function youtubeDescriptionPreview(description: string | undefined) {
  const line = description?.split(/\r?\n/).map(part => part.trim()).find(part => part.length >= 20 && !/^https?:\/\//i.test(part));
  if (!line) return undefined;
  const sentence = line.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? line;
  return sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}…` : sentence;
}
