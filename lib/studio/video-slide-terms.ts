/** Pure: what the slides add to a transcript. The slide text is evidence stored beside the transcript; it does not edit it. */
const COMMON = new Set("that this with from have will your you the and for are was were not but can all any our out has had its how what when where which who why more most some than then them they there these those about into over also just like make made only other such very here open dates window message type typeamessage".split(" "));
const words = (text: string) => text.match(/[A-Za-z][A-Za-z0-9+#.-]{2,}/g) ?? [];
/** OCR noise (stray symbols, one-letter debris) is not worth showing. */
export const usableSlideText = (ocr: string) => words(ocr).filter(w => w.length >= 3).length >= 2;
export interface SlideTerms { terms: number; inSpeech: number; missing: string[]; slidesWithText: number; slides: number }
export function slideTerms(frames: Array<{ ocr_text: string }>, transcript: string): SlideTerms {
  const speech = transcript.toLowerCase().replace(/\[\d\d:\d\d:\d\d\]/g, " ");
  const seen = new Map<string, string>(); let slidesWithText = 0;
  for (const frame of frames) {
    if (!usableSlideText(frame.ocr_text)) continue;
    slidesWithText++;
    for (const word of words(frame.ocr_text)) {
      const key = word.toLowerCase().replace(/[.-]+$/, "");
      // Real terms: not common words; names and product words are capitalised or mix letters and digits.
      if (key.length < 4 || COMMON.has(key) || seen.has(key) || !(/[A-Z]/.test(word) || /\d/.test(word))) continue;
      seen.set(key, word);
    }
  }
  const missing = [...seen].filter(([key]) => !speech.includes(key)).map(([, word]) => word);
  return { terms: seen.size, inSpeech: seen.size - missing.length, missing: missing.slice(0, 12), slidesWithText, slides: frames.length };
}
