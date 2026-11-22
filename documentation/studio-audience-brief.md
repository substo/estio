# Local audience research for Studio

Use a comment collection you have permission to process, such as an export supplied by the creator. The tool reads files on the Mac and asks an installed local Ollama model to look for useful patterns. A YouTube sign-in is for viewing. YouTube's terms generally restrict automated access without permission. Google's account export includes comments written by the account holder. It does not export the audience discussion under arbitrary videos. [YouTube Terms of Service](https://www.youtube.com/t/terms) · [Google Data Portability schema](https://developers.google.com/data-portability/schema-reference/youtube)

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
python3 scripts/studio-audience-brief.py creator-comments.json other-video.csv \
  --model YOUR_LOCAL_MODEL --output first-video-audience \
  --topic "Help first-time creators test two openings for the same video"
```

The model sees your topic, anonymized source IDs, local comment IDs and normalized comment text. Every usable row goes through one extraction batch. Smaller consolidation rounds combine the results into up to eight editorial suggestions. Each round has an input budget and gives each batch a turn before considering additional suggestions. The model must pair each comment ID with a literal excerpt. The tool verifies that the exact excerpt appears in that comment and discards suggestions with no matching citation. Coverage reports discarded citations and suggestions when they occur. Review the excerpts to decide whether each suggestion fits.

The JSON file contains coverage and evidence with the source filename and row number. The Markdown file is the brief for Studio. Both are created with owner-only permissions. The script refuses to overwrite existing output.

## Use the brief in Studio

Open **Create with Studio** from your source. Paste the suggestions you want to use and ask for a decision or proposal. For example, “Show me one alternative concept, one demonstration to deepen this script, and one passage to cut. Give me the spoken opening for each angle. Tell me which comments motivated the changes and which claims need factual sources.”

On a draft, open **Audience language → Open a local audience brief** and choose the generated JSON file. Expand **Review comment excerpts** to check the suggestion against the source. Choose **Review as observation**, edit the wording, then choose **Add**. The contents of the file stay in the browser. The selected observation becomes draft context for wording and creative direction. Use approved Knowledge or an independent source for factual claims.
