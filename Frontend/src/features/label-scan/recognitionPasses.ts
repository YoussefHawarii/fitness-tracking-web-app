import type { BBox, OcrWord } from './ocrLayout';

// Combining Tesseract's recognition passes into one trustworthy layout.
//
// Measured on rendered Arabic and bilingual labels, Tesseract.js v7 cannot
// be trusted with numbers when Arabic is involved:
// - recognising with eng+ara together degrades English: "21 g" → "219",
//   "2.4 g" → "249g", "42%" → "4296";
// - the Arabic model truncates numbers on right-to-left lines to their last
//   digit ("21" → "1", "12.5" → "5") at 95% confidence, and reverses or
//   misreads Arabic-Indic digits ("١٠٠" → "٠٠١", "٢٥٠" → "You");
// - an English-only page pass misreads numbers next to Arabic text too.
// What did read every number correctly is an English-only re-read of a
// small crop around it (single-line mode). So a scan runs an English page
// pass (layout, English words, numbers' positions), an Arabic page pass
// (Arabic words only), merges them by position, and then re-reads every
// number from its own crop. A number that can't be confirmed that way is
// marked unverified and is never read.

const ARABIC_LETTER = /[ء-ي]/;
const ARABIC_INDIC_DIGIT = /[٠-٩۰-۹]/;
const DIGIT = /[0-9٠-٩۰-۹]/;
// Directional marks Tesseract wraps around left-to-right runs.
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;

function clean(word: OcrWord): OcrWord {
  return { ...word, text: word.text.replace(BIDI_MARKS, '').trim() };
}

function overlapArea(a: BBox, b: BBox): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

function area(box: BBox): number {
  return Math.max(0, box.x1 - box.x0) * Math.max(0, box.y1 - box.y0);
}

// Whether two boxes cover substantially the same ink: their overlap is at
// least a third of the smaller box.
function sameInk(a: BBox, b: BBox): boolean {
  const smaller = Math.min(area(a), area(b));
  return smaller > 0 && overlapArea(a, b) >= smaller / 3;
}

export const hasDigit = (text: string): boolean => DIGIT.test(text);

// Below this confidence an Arabic-pass word is treated as noise: the Arabic
// model reads English text as Arabic-looking gibberish at 0-40%, while
// real Arabic words score ~85-96%.
const MIN_ARABIC_PASS_CONFIDENCE = 50;

// Merges the English and Arabic page passes. Each model also "reads" the
// other language's text as low-confidence gibberish, so where an Arabic-
// script word and English-pass words cover the same ink, the more
// confident reading wins. A number only the Arabic pass found is added
// where nothing else was read, so it can be re-read from its crop.
export function mergeRecognitionPasses(
  englishPass: readonly OcrWord[],
  arabicPass: readonly OcrWord[],
): OcrWord[] {
  let english: OcrWord[] = englishPass
    .map(clean)
    .filter((w) => w.text && !ARABIC_LETTER.test(w.text))
    .map((w) => ({ ...w, recognizedBy: 'english' as const }));
  const arabic = arabicPass
    .map(clean)
    .filter((w) => w.text && w.confidence >= MIN_ARABIC_PASS_CONFIDENCE)
    .map((w) => ({ ...w, recognizedBy: 'arabic' as const }));

  const kept: OcrWord[] = [];
  for (const word of arabic.filter((w) => ARABIC_LETTER.test(w.text))) {
    const rivals = english.filter((e) => sameInk(e.bbox, word.bbox));
    if (rivals.every((e) => e.confidence < word.confidence)) {
      english = english.filter((e) => !rivals.includes(e));
      kept.push(word);
    }
  }
  const merged = [...kept, ...english];
  for (const word of arabic) {
    if (ARABIC_LETTER.test(word.text) || !hasDigit(word.text)) continue;
    if (merged.some((m) => sameInk(m.bbox, word.bbox))) continue;
    merged.push(word);
  }
  return merged;
}

export interface CropRectangle {
  left: number;
  top: number;
  width: number;
  height: number;
}

// The region re-read for a number: its box widened by a few character
// heights each side, because the Arabic pass may have boxed only the last
// digit of a truncated number.
export function numberCrop(
  box: BBox,
  imageWidth: number,
  imageHeight: number,
): CropRectangle {
  const height = Math.max(1, box.y1 - box.y0);
  const left = Math.max(0, Math.round(box.x0 - 2.5 * height));
  const top = Math.max(0, Math.round(box.y0 - 0.4 * height));
  const right = Math.min(imageWidth, Math.round(box.x1 + 2.5 * height));
  const bottom = Math.min(imageHeight, Math.round(box.y1 + 0.4 * height));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function digitsOf(text: string): string {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).join('|');
}

// Applies an English re-read of a number's crop. A number is verified only
// when two independent readings agree: the page pass's reading and the
// re-read, digit for digit (decimal point included). On rendered labels
// each reading on its own was sometimes wrong — a truncated "1" for "21",
// "125g" for "12.5 g" — but they disagreed when they were. Anything else —
// no number in the re-read, several, or a mismatch — leaves the number
// unverified, and an unverified number is never read. Arabic-Indic digits
// can't be re-read by the English model, so they are always unverified.
export function verifyNumberWord(
  word: OcrWord,
  cropWords: readonly OcrWord[],
): OcrWord {
  const unverified: OcrWord = { ...word, numberCheck: 'unverified' };
  if (ARABIC_INDIC_DIGIT.test(word.text)) return unverified;
  const overlapping = cropWords
    .map(clean)
    .filter((w) => w.text && overlapArea(w.bbox, word.bbox) > 0)
    .sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const numbers = overlapping.filter((w) => hasDigit(w.text));
  if (numbers.length !== 1) return unverified;
  if (digitsOf(numbers[0].text) !== digitsOf(word.text)) return unverified;
  // Keep the number and any Latin unit or symbols printed with it; an
  // Arabic unit fused to the number ("21جم") keeps its Arabic letters.
  const reread = overlapping
    .filter((w) => !ARABIC_LETTER.test(w.text))
    .map((w) => w.text)
    .join(' ');
  const arabicPart = word.text.replace(/[^ء-ي]+/g, ' ').trim();
  return {
    ...word,
    text: [reread, arabicPart].filter(Boolean).join(' '),
    numberCheck: 'verified',
  };
}
