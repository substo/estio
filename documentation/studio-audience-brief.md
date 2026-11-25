# Local audience research for Studio

Use a comment collection you have permission to collect and process. The Mac browser collector uses regular YouTube pages and your Studio Chrome profile. The analyzer reads the export on the Mac. You choose either on-device inference with Ollama or a native subscription. Neither step needs a Google API key.

## Collect from YouTube on the Mac

Run from the Estio checkout with its Node dependencies installed. Use only video URLs covered by your permission. The collector uses the same dedicated profile as Studio's Related videos search. The collector rejects optional cookies when YouTube offers that choice. If the profile needs sign-in or a consent choice remains, open that profile through the existing Studio command, finish the browser prompt, and quit its Chrome windows before collecting.

```sh
npm run start:studio-companion -- youtube-login
```

```sh
npx tsx scripts/studio-youtube-comments.ts --confirm-permission --output ~/studio-comments \
  'https://www.youtube.com/watch?v=YOUR_VIDEO_ID'
```

Pass multiple URLs to collect from several videos in one run. Add `--limit 50` to cap a trial at 50 rows per video. The default tries to exhaust the top-level pages and expand the replies YouTube makes available. It attempts Newest first when the menu is available and records which order it could verify. Add `--keep-order` to keep YouTube's initial order for a sample. Each video gets a private JSON file with the visible count when available, the reason it stopped and any unresolved reply threads. An interrupted export is usable but partial. Reaching the end means the browser offered no further page. The visible count can differ, for example when YouTube withholds comments.

The export includes comment text and comment/reply IDs for provenance. It excludes author and account metadata and redacts common contact details from the text. Existing export files are preserved. Use a new output folder for a new run.

## Prepare and preview

Pass one or more UTF-8 JSON, JSONL, NDJSON or CSV files. Each row should have `text` and a `video` label or `video_id`. A CSV needs headers. JSON can also contain a `comments` array and a top-level `video` label. If you omit the label, the import uses the filename. Keep one video per file in that case.

```json
{"video":"Creator opening experiment","comments":[{"text":"I wanted to see both versions before hearing the explanation."}]}
```

```sh
python3 scripts/studio-audience-brief.py creator-comments.json other-video.csv --preview
```

Preview reports how many rows are usable, duplicate, empty or shortened. Each run accepts up to 50,000 rows and each input file up to 64 MiB. It removes exact duplicates within a source after whitespace normalization, contact redaction and case folding. Only the first 2,000 characters of a long comment go into analysis. Author fields are ignored. Review the output for any personal details that people wrote in the comment itself.

## Choose a model for comment analysis

Open **Audience language → Choose an analysis model** on a draft. Select a route and enter its exact model name. Studio shows the Mac command. Run it from the checkout that has the collector and analyzer. The browser does not launch a local executable or upload the corpus. The route and model are per analysis run and appear on the imported brief.

| Route | Model setting | Where comments are processed |
| --- | --- | --- |
| Ollama on the Mac | Use the exact installed name from `ollama list`. | The Mac, via its local Ollama service. |
| Codex subscription | Supply a model from `npx tsx scripts/studio-audience-subscription.ts codex list status`, such as `gpt-6.2-sol`. | OpenAI, through the Mac's signed-in Codex CLI. |
| Claude Code subscription | Supply a model from `npx tsx scripts/studio-audience-subscription.ts claude list status`, such as `claude-sonnet-5-5`. | Anthropic, through the Mac's signed-in Claude Code CLI. |

Use a corpus you have permission to process on the route you choose. Subscription routes require native subscription sign-in. They exclude API-key and Console logins and never fall back to another provider. Ollama needs its local service running and an installed model. [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)

```sh
python3 scripts/studio-audience-brief.py ~/studio-comments/youtube-*.json \
  --provider codex --model gpt-6.2-sol --output first-video-audience \
  --topic "Help first-time creators test two openings for the same video"
```

The model sees your topic, anonymized source IDs, local comment IDs and normalized comment text. Every usable row goes through one extraction batch. Smaller consolidation rounds combine the results into up to eight editorial suggestions. Each round has an input budget and gives each batch a turn before considering additional suggestions. The model must pair each comment ID with a literal excerpt. The tool verifies that the exact excerpt appears in that comment and discards suggestions with no matching citation. Coverage reports discarded citations and suggestions when they occur. Review the excerpts to decide whether each suggestion fits.

The JSON file contains coverage and evidence with the source filename and row number. The Markdown file is the brief for Studio. Both are created with owner-only permissions. The script refuses to overwrite existing output.

## Use the brief in Studio

Open **Script → Writing agent → Audience language** on an existing piece. On a phone, tap **Ask about this script** first. The same controls are available in **Create with Studio → Audience language**. Choose the JSON file in **Open a local audience brief**. Expand **Review comment excerpts** to check each suggestion against its source. The brief stays in the browser until you choose what to save or send.

- **Explore angles** asks for distinct concepts with titles, spoken hooks, and payoffs.
- **Deepen the draft** asks for a demonstration, an objection to address, and precise lines or shots to add.
- **Tighten the draft** asks what to cut and how to deliver the title's promise sooner.
- **Use this suggestion** prepares one draft request with a single supporting excerpt.
- **Review as observation** lets you edit and save one observation for later chat turns.

The writing actions prepare an editable Assistant message with a small selection of supporting excerpts. Inside Script mode they return to the same composer and keep any unsent text. Review it and choose **Process with** before pressing **Send**. That dropdown controls writing and revision, independently of the analysis model on the brief. The paired-Mac route follows the native text provider and model in **Settings → Devices**. **Location AI order** follows **Settings → AI** and its configured providers. The Assistant shows the route used in **What this answer used**. Use approved Knowledge or an independent source for factual claims.

Each suggestion also prepares a targeted edit for its section. For opening, explanation and payoff edits, the agent is asked to show the affected lines before and after, keeping the rest of the script intact. **Suggest a script edit** uses an observation that you already saved. The composer shows the request before you send it.
