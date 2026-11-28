// yt-dlp's full JSON includes playback formats and every translated caption URL. Print only what Studio reads.
export const youtubeSourceMetadataTemplate =
  "%(.{title,description,channel,channel_url,uploader,uploader_url,upload_date,duration,is_live,view_count,like_count,comment_count,tags,chapters,thumbnail,comments})j";

/** What yt-dlp's single metadata run reports about a YouTube video, trimmed to what the Source page shows. Pure: used by the Mac companion, the device policy and the page. */
export const SOURCE_COMMENT_LIMIT = 50;
export interface SourceComment { author: string; text: string; likes: number | null; replies: number | null; at: number | null; pinned: boolean; byUploader: boolean }
export interface SourceMeta {
  title: string; channel: string; uploadDate: string | null; duration: number | null; viewCount: number | null; likeCount: number | null; commentCount: number | null;
  tags: string[]; chapters: Array<{ start: number; title: string }>; thumbnail: string | null;
  comments: SourceComment[]; /** Why comments are missing; null when they were fetched (even if there are none). */ commentsError: string | null;
}
/** One `--extractor-args` value: yt-dlp merges everything for `youtube` from a single flag, so comments ride on the existing metadata request. */
export const commentExtractorArgs = `comment_sort=top;max_comments=${SOURCE_COMMENT_LIMIT},${SOURCE_COMMENT_LIMIT},0,0`;

const count = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
const text = (value: unknown, max: number) => typeof value === "string" ? value.replace(/\0/g, "").trim().slice(0, max) : "";
const day = (value: unknown) => { const s = typeof value === "string" ? value : ""; return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null; };

/** Reason shown when `--write-comments` produced nothing. Text only informs the message, never a command. */
export function commentsFailureReason(stderr: string, commentCount: number | null): string {
  if (/comments? (are|is) turned off|comments? (are|is) disabled|disabled comments/i.test(stderr)) return "Comments are turned off for this video.";
  if (commentCount === 0) return "This video has no comments yet.";
  if (/429|too many requests/i.test(stderr)) return "YouTube limited the comments request. They were not fetched; Studio will not ask again during the cool-down.";
  return "YouTube returned no comments for this video (they may be turned off or temporarily unavailable).";
}

export function parseYoutubeSourceMeta(json: Record<string, unknown>, stderr = ""): SourceMeta {
  const raw = Array.isArray(json.comments) ? json.comments as Array<Record<string, unknown>> : null;
  const comments = (raw ?? []).filter(c => c && (c.parent === "root" || c.parent === undefined || c.parent === null) && text(c.text, 10)).slice(0, SOURCE_COMMENT_LIMIT).map((c): SourceComment => ({
    author: text(c.author, 80) || "Unknown", text: text(c.text, 600), likes: count(c.like_count), replies: count(c.reply_count), at: count(c.timestamp),
    pinned: c.is_pinned === true, byUploader: c.author_is_uploader === true }));
  const commentCount = count(json.comment_count);
  const chapters = (Array.isArray(json.chapters) ? json.chapters as Array<Record<string, unknown>> : []).flatMap(c => { const start = count(c.start_time); const title = text(c.title, 120); return start !== null && title ? [{ start, title }] : []; }).slice(0, 60);
  return {
    title: text(json.title, 300), channel: text(json.channel ?? json.uploader, 200), uploadDate: day(json.upload_date), duration: count(json.duration), viewCount: count(json.view_count), likeCount: count(json.like_count), commentCount,
    tags: (Array.isArray(json.tags) ? json.tags : []).filter((t): t is string => typeof t === "string").map(t => t.trim().slice(0, 60)).filter(Boolean).slice(0, 25), chapters,
    thumbnail: typeof json.thumbnail === "string" && /^https:\/\//.test(json.thumbnail) ? json.thumbnail.slice(0, 500) : null,
    comments, commentsError: comments.length ? null : commentsFailureReason(stderr, commentCount),
  };
}

/** Server-side check of what a Mac sent; anything malformed is rejected, nothing is trusted as markup. */
export function readSourceMeta(value: unknown): SourceMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const comments = Array.isArray(v.comments) ? v.comments.slice(0, SOURCE_COMMENT_LIMIT).flatMap((c): SourceComment[] => {
    const o = c as Record<string, unknown>; if (!o || typeof o !== "object" || typeof o.text !== "string") return [];
    return [{ author: text(o.author, 80) || "Unknown", text: text(o.text, 600), likes: count(o.likes), replies: count(o.replies), at: count(o.at), pinned: o.pinned === true, byUploader: o.byUploader === true }];
  }) : [];
  const chapters = Array.isArray(v.chapters) ? v.chapters.slice(0, 60).flatMap(c => { const o = c as Record<string, unknown>; const start = count(o?.start); const title = text(o?.title, 120); return start !== null && title ? [{ start, title }] : []; }) : [];
  return {
    title: text(v.title, 300), channel: text(v.channel, 200), uploadDate: typeof v.uploadDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.uploadDate) ? v.uploadDate : null,
    duration: count(v.duration), viewCount: count(v.viewCount), likeCount: count(v.likeCount), commentCount: count(v.commentCount),
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string").map(t => text(t, 60)).filter(Boolean).slice(0, 25) : [], chapters,
    thumbnail: typeof v.thumbnail === "string" && /^https:\/\//.test(v.thumbnail) ? v.thumbnail.slice(0, 500) : null,
    comments, commentsError: v.commentsError === null || v.commentsError === undefined ? null : text(v.commentsError, 300) || null,
  };
}
