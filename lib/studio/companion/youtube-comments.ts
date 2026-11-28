import type { Locator, Page } from "playwright";
import { SOURCE_DETAILS_BATCH, readSourceDetailsRows, type SourceDetailsRow } from "../source-details-policy";

const THREAD = "ytd-comment-thread-renderer";
const COMMENT = "ytd-comment-view-model, ytd-comment-renderer";
const REPLIES = "ytd-comment-replies-renderer";
const NEXT = "ytd-continuation-item-renderer";
const TOP_NEXT = `:scope > #sections > #contents > ${NEXT}`;
const REPLY_BUTTON = "#more-replies button, #more-replies [role=button], #expander button[aria-expanded=false]";
const WAIT_MS = 12_000;

export type CollectedComment = {
  text: string;
  comment_id?: string;
  parent_id?: string;
  video_id: string;
};

type Result = {
  comments: CollectedComment[];
  status: "reached_end" | "limited" | "unavailable" | "interrupted";
  reason?: string;
  displayed_count?: string;
  unresolved_reply_threads: number;
  order: "newest_first" | "youtube_default";
  signed_in?: boolean;
};

function navigationIssue(page: Page) {
  const url = new URL(page.url());
  if (url.hostname === "consent.youtube.com") return "This browser profile needs its YouTube consent choice.";
  if (url.hostname === "accounts.google.com") return "YouTube asked this profile to sign in.";
  if (url.pathname.startsWith("/sorry")) return "YouTube requested a browser verification.";
  return null;
}

// The consent form may arrive after the watch page has already rendered.
async function rejectOptionalCookies(page: Page) {
  const reject = page.getByText(/^Reject all$/i).filter({ visible: true }).first();
  if (!await reject.isVisible()) return;
  await reject.click({ timeout: 5_000 }).catch(() => {});
  await reject.waitFor({ state: "hidden", timeout: 8_000 }).catch(() => {});
}

function parseVisibleCount(label: string | undefined): number | null {
  const match = label?.replace(/,/g, "").match(/^(\d+(?:\.\d+)?)\s*([KMB])?\b/i);
  if (!match) return null;
  const multipliers: Record<string, number> = { K: 1000, M: 1e6, B: 1e9 };
  return Math.round(Number(match[1]) * (multipliers[match[2]?.toUpperCase()] ?? 1));
}

async function textRows(container: Locator, videoId: string, parentId?: string, includeDetails = false) {
  const rows = await container.locator(COMMENT).evaluateAll((nodes, includeDetails) => nodes.flatMap(node => {
    const body = node.querySelector("#content-text, yt-attributed-string#content");
    const text = body?.textContent?.trim();
    if (!text) return [];
    const link = node.querySelector<HTMLAnchorElement>('a[href*="lc="]');
    const id = link ? new URL(link.href).searchParams.get("lc") : null;
    const details = includeDetails ? {
      author: node.querySelector("#author-text")?.textContent?.trim(),
      published: node.querySelector("#published-time-text")?.textContent?.trim(),
      likesLabel: node.querySelector("#vote-count-middle")?.textContent?.trim(),
      pinned: Boolean(node.querySelector("#pinned-comment-badge")?.textContent?.trim()),
      byUploader: Boolean(node.querySelector("#author-text[is-channel-owner]")),
    } : {};
    return [{ text, id: id && /^[\w-]{8,200}$/.test(id) ? id : null, ...details }];
  }), includeDetails);
  return rows.map(({ text, id, likesLabel, ...details }) => ({
    text: includeDetails ? text : text.replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b|(?<!\w)@[\p{L}\p{N}_.-]+|https?:\/\/\S+/giu, "[redacted]"),
    ...details,
    ...(includeDetails ? { likes: parseVisibleCount(likesLabel) } : {}),
    video_id: videoId,
    ...(id ? { comment_id: id } : {}),
    ...(parentId ? { parent_id: parentId } : {}),
  }));
}

async function activate(page: Page, target: Locator) {
  await target.evaluate(node => {
    node.scrollIntoView({ block: "center" });
    window.dispatchEvent(new Event("scroll"));
  }, undefined, { timeout: 3_000 });
  await page.mouse.wheel(0, 180);
  const button = target.locator("button:visible, [role=button]:visible").first();
  if (await button.count()) await button.click({ timeout: 3_000 }).catch(() => {});
}

async function waitForGrowth(page: Page, selector: string, index: number | null, previous: number) {
  return page.waitForFunction(({ selector, index, previous, thread, comment }) => {
    const box = index === null ? document.querySelector("ytd-comments") : document.querySelectorAll(thread)[index];
    if (!box) return false;
    const count = index === null ? box.querySelectorAll(thread).length : box.querySelector(selector)?.querySelectorAll(comment).length ?? 0;
    return count > previous;
  }, { selector, index, previous, thread: THREAD, comment: COMMENT }, { timeout: WAIT_MS }).then(() => true, () => false);
}

/** Drives the visible comment UI. A stalled continuation is reported even when earlier comments were saved. */
export async function collectYoutubeComments(page: Page, videoId: string, limit: number,
  progress: (size: number) => void = () => {}, preferNewest = true,
  live?: { rows: (rows: SourceDetailsRow[]) => Promise<void>; signal: AbortSignal }): Promise<Result> {
  const comments: CollectedComment[] = [];
  const seen = new Set<string>();
  let pending: SourceDetailsRow[] = [];
  let writeError: unknown;
  const flush = async () => {
    live?.signal.throwIfAborted();
    if (!live || !pending.length) return;
    const batch = pending;
    pending = [];
    try { await live.rows(batch); } catch (error) { writeError = error; throw error; }
  };
  const beforeLoad = async () => {
    await flush();
    // Allow the watch page to settle before asking it for another page of replies or comments.
    if (live) await page.waitForTimeout(1500);
    live?.signal.throwIfAborted();
  };
  const result: Result = { comments, status: "reached_end", unresolved_reply_threads: 0, order: "youtube_default" };
  const stop = async (status: Result["status"], reason: string) => { await flush(); return { ...result, status, reason }; };
  const append = async (row: CollectedComment, fallback: string, replies?: number | null) => {
    const id = row.comment_id ?? fallback;
    if (!seen.has(id) && comments.length < limit) {
      seen.add(id);
      comments.push({ ...row, comment_id: id });
      if (live) {
        const parsed = readSourceDetailsRows([{ ...row, id, parentId: row.parent_id ?? null, replies }]);
        if (parsed) pending.push(...parsed);
        if (pending.length >= SOURCE_DETAILS_BATCH) await flush();
      }
      if (comments.length % 20 === 0) progress(comments.length);
    }
    return id;
  };

  await rejectOptionalCookies(page);
  const root = page.locator("ytd-comments").first();
  const threads = root.locator(THREAD);
  const issue = navigationIssue(page);
  if (issue) return stop("unavailable", issue);
  if (!await root.waitFor({ state: "attached", timeout: WAIT_MS }).then(() => true, () => false)) {
    return stop("unavailable", navigationIssue(page) ?? "YouTube did not render the comments panel.");
  }
  if (!await threads.count()) {
    const first = root.locator(TOP_NEXT).first();
    if (await first.count()) await activate(page, first).catch(() => {});
    else await root.evaluate(node => node.scrollIntoView({ block: "center" }));
  }
  const ready = await page.waitForFunction(() => {
    const panel = document.querySelector("ytd-comments");
    return !!panel?.querySelector("ytd-comment-thread-renderer") ||
      !!panel?.querySelector("ytd-message-renderer")?.textContent?.trim();
  }, undefined, { timeout: WAIT_MS }).then(() => true, () => false);
  await rejectOptionalCookies(page);
  if (await page.getByText("Before you continue to YouTube", { exact: true }).filter({ visible: true }).first().isVisible()) {
    return stop("unavailable", "This browser profile needs its YouTube consent choice.");
  }
  result.displayed_count = (await root.locator("ytd-comments-header-renderer #count").first()
    .textContent({ timeout: 1_000 }).catch(() => ""))?.trim() || undefined;
  if (!ready || !await threads.count()) {
    const message = await root.locator("ytd-message-renderer").first().textContent({ timeout: 1_000 }).catch(() => "");
    return stop("unavailable", navigationIssue(page) || message?.trim() || "YouTube did not return comments in this browser.");
  }

  result.signed_in = await page.locator("ytd-masthead #avatar-btn").first().isVisible();
  try {
    const header = root.locator("ytd-comments-header-renderer");
    const sort = header.locator("#sort-menu #trigger, #sort-menu button, #sort-menu [role=button]")
      .or(header.getByRole("button", { name: /sort by/i })).or(header.getByText(/^Sort by$/i))
      .filter({ visible: true }).first();
    if (preferNewest && await sort.isVisible()) {
      await sort.click({ timeout: 3_000 }).catch(() => {});
      const newest = page.getByText(/^Newest first$/i).filter({ visible: true }).first();
      if (await newest.waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false)) {
        const previous = await threads.first().elementHandle({ timeout: 3_000 }).catch(() => null);
        await newest.click({ timeout: 3_000 }).then(async () => {
          if (!previous) return;
          await page.waitForFunction(node => !node.isConnected, previous, { timeout: WAIT_MS });
          await threads.first().waitFor({ state: "attached", timeout: WAIT_MS });
          result.order = "newest_first";
        }).catch(() => {});
        await previous?.dispose().catch(() => {});
      } else {
        await page.keyboard.press("Escape");
      }
    }
    let processed = 0;
    for (;;) {
      const total = await threads.count();
      for (; processed < total; ++processed) {
        const thread = threads.nth(processed);
        const [top] = await textRows(thread, videoId, undefined, Boolean(live));
        if (!top) return stop("interrupted", "A visible comment could not be read. Earlier rows were kept.");
        const replies = thread.locator(REPLIES).first();
        const replyLabel = replies.locator("#more-replies").first();
        const buttonText = live && await replyLabel.count() ? await replyLabel.textContent({ timeout: 500 }).catch(() => null) : null;
        const replyCount = buttonText?.replace(/,/g, "").match(/(\d+)\s+repl(?:y|ies)/i);
        const parent = await append(top, `thread-${processed + 1}`, replyCount ? Number(replyCount[1]) : null);
        if (comments.length >= limit) return stop("limited", "Stopped at the requested row limit.");

        if (await replies.count()) {
          const accessible = replies.getByRole("button", { name: /^\d[\d,.\s]* repl(?:y|ies)$/i });
          const open = accessible.or(replies.locator(REPLY_BUTTON)).filter({ visible: true }).first();
          const next = replies.locator(`${NEXT}:visible`).last();
          let unresolved = false;
          if (!await replies.locator(COMMENT).count() && await open.isVisible()) {
            await beforeLoad();
            await open.click({ timeout: 4_000 }).catch(() => {});
            unresolved = !await waitForGrowth(page, REPLIES, processed, 0);
          }
          for (;;) {
            const rows = await textRows(replies, videoId, parent, Boolean(live));
            for (const [index, row] of rows.entries()) await append(row, `${parent}:reply-${index + 1}`);
            if (comments.length >= limit) return stop("limited", "Stopped at the requested row limit.");
            if (!await next.count()) break;
            await beforeLoad();
            await activate(page, next).catch(() => {});
            if (!await waitForGrowth(page, REPLIES, processed, rows.length)) {
              unresolved = true;
              break;
            }
          }
          if (unresolved) result.unresolved_reply_threads++;
        }
      }
      const next = root.locator(TOP_NEXT).last();
      if (!await next.count()) break;
      await beforeLoad();
      await activate(page, next).catch(() => {});
      if (!await waitForGrowth(page, THREAD, null, total)) {
        return stop("interrupted", "YouTube stopped adding comment threads. Earlier rows were kept.");
      }
    }
    if (result.unresolved_reply_threads) return stop("interrupted", "Some replies could not be loaded.");
    await flush();
    return result;
  } catch {
    if (writeError) throw writeError;
    live?.signal.throwIfAborted();
    return stop("interrupted", "The comments page stopped responding. Earlier rows were kept.");
  }
}
