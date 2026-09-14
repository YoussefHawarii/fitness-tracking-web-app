// Splits a confirmed transcript into individual food terms so "chicken and
// rice" logs as two separate items instead of one failed combined search —
// per docs/business-logic.md §5 step 3 (spec'd, never implemented — see
// docs/food-log-input-modes-diagnosis.md §2.3). Handles commas and
// "and"/"with" in English, and Arabic "و" (and) as a standalone word
// ("فراخ و رز"), as the common attached prefix Egyptian speech-to-text
// produces ("فراخ ورز"), and at the start of the transcript ("وفراخ").
// This is a heuristic, not real NLP — a word that happens to legitimately
// start with و (e.g. "ورق", leaves) can be mis-split, and filler words
// (verbs, articles) around the food names aren't stripped; the transcript
// stays editable before this runs, and any wrongly-split or unstripped
// fragment just shows "no match found" rather than silently doing the wrong
// thing.
export function splitIntoFoodTerms(transcript: string): string[] {
  const normalized = transcript.trim();
  if (!normalized) return [];
  const parts = normalized.split(
    /\s*[,،]\s*|\s+(?:and|with)\s+|\s+و\s+|(?<=\s)و(?=\S)|^و(?=\S)/giu,
  );
  // An Oxford-comma list ("eggs, toast, and orange juice") splits on the
  // comma before the "and"/"with" branch gets a chance to also consume it,
  // leaving that word stuck on the front of the last item — strip it here.
  return parts
    .map((p) => p.trim().replace(/^(?:and|with)\s+/i, ''))
    .filter((p) => p.length > 0);
}
