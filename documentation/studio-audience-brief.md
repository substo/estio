# Local audience research for Studio

Use a comment collection you have permission to collect and process. The Mac browser collector uses regular YouTube pages and your Studio Chrome profile. The analyzer reads the export locally and uses an installed Ollama model. Neither step needs a Google API key.

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

## Analyze locally

Use an installed instruction-following model that reliably produces structured output. Run `ollama list` to find its exact name and start the local Ollama service if needed. [Ollama structured outputs](https://docs.ollama.com/capabilities/structured-outputs)

```sh
python3 scripts/studio-audience-brief.py ~/studio-comments/youtube-*.json \
  --model YOUR_LOCAL_MODEL --output first-video-audience \
  --topic "Help first-time creators test two openings for the same video"
```

The model sees your topic, anonymized source IDs, local comment IDs and normalized comment text. Every usable row goes through one extraction batch. Smaller consolidation rounds combine the results into up to eight editorial suggestions. Each round has an input budget and gives each batch a turn before considering additional suggestions. The model must pair each comment ID with a literal excerpt. The tool verifies that the exact excerpt appears in that comment and discards suggestions with no matching citation. Coverage reports discarded citations and suggestions when they occur. Review the excerpts to decide whether each suggestion fits.

The JSON file contains coverage and evidence with the source filename and row number. The Markdown file is the brief for Studio. Both are created with owner-only permissions. The script refuses to overwrite existing output.

## Use the brief in Studio

Open **Create with Studio** from your source. Paste the suggestions you want to use and ask for a decision or proposal. For example, “Show me one alternative concept, one demonstration to deepen this script, and one passage to cut. Give me the spoken opening for each angle. Tell me which comments motivated the changes and which claims need factual sources.”

On a draft, open **Audience language → Open a local audience brief** and choose the generated JSON file. Expand **Review comment excerpts** to check the suggestion against the source. Choose **Review as observation**, edit the wording, then choose **Add**. The contents of the file stay in the browser. The selected observation becomes draft context for wording and creative direction. Use approved Knowledge or an independent source for factual claims.
