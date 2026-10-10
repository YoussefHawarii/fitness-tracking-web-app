import type { NutritionBasis } from '../../services/foodService';
import type { BBox, OcrLayout, OcrWord } from './ocrLayout';
import { MASS_UNITS, MILLIGRAM_UNITS, QUANTITY_UNITS } from './labelUnits';
import { isBracketedDigit } from './recognitionPasses';

// The Label reader: a pure function from a Label scan's word layout to
// Label readings (CONTEXT.md). It associates numbers with nutrients by
// where the words sit on the photo — rows by vertical position, segments
// by nutrient keyword — never by the raw order Tesseract emitted the text
// in. Anything it cannot place with certainty is left without a value
// rather than guessed; a missing value is never turned into zero.

export type LabelField =
  | 'caloriesPer100g'
  | 'proteinPer100g'
  | 'carbsPer100g'
  | 'sugarPer100g'
  | 'fatPer100g'
  | 'fiberPer100g'
  // Sodium per 100, in milligrams as labels print it (stored as grams).
  | 'sodiumMgPer100'
  | 'servingSize'
  | 'packageSize';

export const LABEL_FIELDS: readonly LabelField[] = [
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'sugarPer100g',
  'fatPer100g',
  'fiberPer100g',
  'sodiumMgPer100',
  'servingSize',
  'packageSize',
];

// Quantities describe the serving and the package, not the per-100 table:
// they are read from their own rows ("Serving size 30 g", "Net wt 40 g"),
// whichever column they sit in.
const QUANTITY_FIELDS: ReadonlySet<LabelField> = new Set([
  'servingSize',
  'packageSize',
]);

export type LabelReadingStatus = 'read' | 'needs-check' | 'not-found';

export interface LabelEvidence {
  // The row of label text as recognised.
  rowText: string;
  // Where the reading's words sit on the photo.
  bbox: BBox;
}

export interface LabelReading {
  field: LabelField;
  value?: number;
  unit?: string;
  status: LabelReadingStatus;
  warnings: string[];
  evidence?: LabelEvidence;
  // A bilingual label printed this value in both English and Arabic, and
  // both read the same.
  confirmedInBothLanguages?: boolean;
  // Different values read for this field (e.g. English 12 g, Arabic 1.2 g);
  // the field is left empty and the user decides.
  conflictingValues?: number[];
  // How the value was converted from what the label printed: calories from
  // kJ (÷ 4.184), or sodium from grams to milligrams.
  conversion?: 'from-kj' | 'from-g';
}

// 'ok' — readings came from a column the label headed per 100 g / 100 ml.
// 'per-serving-only' — the label lists only per-serving values; readings
// are shown for reference and never fill a per-100 field (ADR 0009).
// 'no-per-100-column' — no single per-100 header was read, so no reading
// may fill a per-100 field either.
export type LabelScanOutcome = 'ok' | 'per-serving-only' | 'no-per-100-column';

export interface LabelScanResult {
  outcome: LabelScanOutcome;
  // A Declared nutrition basis suggestion, present only when the label's
  // own header states it.
  basisSuggestion?: NutritionBasis;
  readings: LabelReading[];
  warnings: string[];
  // The photo couldn't be read reliably: fewer than two of calories,
  // protein, carbs and fat passed every check, or the table's words were
  // recognised with low confidence. Whatever passed is still shown, but
  // nothing is pre-selected for the form.
  weakScan?: boolean;
}

export const WEAK_SCAN_MESSAGE =
  'Couldn’t read this label reliably — retake closer, flat, and well lit.';

// ---------------------------------------------------------------------------
// Rows

interface Row {
  words: OcrWord[];
  y0: number;
  y1: number;
}

// Words read from a straightened copy carry two boxes: where they sit on the
// photo and where they sat in the copy, whose rows are level. The reader works
// in the copy's coordinates — rows, columns and units are placed there, so a
// value far to the right of its label can't slide onto the next row of a
// tilted photo — and reports evidence on the photo. The photo box of such a
// word is kept here, keyed by the word the reader works with.
const photoBoxes = new WeakMap<OcrWord, BBox>();

// Every word of a read comes from one copy, so all have a copy box or none do;
// if a mix ever arrives, the boxes are of two spaces and not comparable, so the
// photo boxes are used for all.
function inReadingSpace(words: readonly OcrWord[]): OcrWord[] {
  if (!words.every((word) => word.layoutBox)) return [...words];
  return words.map((word) => {
    const reading: OcrWord = {
      ...word,
      bbox: word.layoutBox as BBox,
      layoutBox: undefined,
    };
    photoBoxes.set(reading, word.bbox);
    return reading;
  });
}

function verticalOverlapRatio(a: BBox, y0: number, y1: number): number {
  const overlap = Math.min(a.y1, y1) - Math.max(a.y0, y0);
  const smaller = Math.min(a.y1 - a.y0, y1 - y0);
  return smaller > 0 ? overlap / smaller : 0;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

const centreX = (box: BBox) => (box.x0 + box.x1) / 2;
const centreY = (box: BBox) => (box.y0 + box.y1) / 2;

// The tilt of the text lines (vertical change per pixel across) from words
// that sit next to each other on one line: the median over each word and its
// nearest neighbour to the right. A photographed table is rarely level, and
// a tilt of a few degrees already lifts the far end of a row by more than
// the row spacing. Zero when there are too few pairs to measure it.
function lineSlope(words: readonly OcrWord[]): number {
  const byX = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const height = median(words.map((w) => w.bbox.y1 - w.bbox.y0));
  const slopes: number[] = [];
  for (let i = 0; i < byX.length; i += 1) {
    const a = byX[i].bbox;
    for (let j = i + 1; j < byX.length; j += 1) {
      const b = byX[j].bbox;
      if (b.x0 - a.x1 > 3 * height) break;
      const dx = centreX(b) - centreX(a);
      if (dx < height || verticalOverlapRatio(b, a.y0, a.y1) < 0.3) continue;
      slopes.push((centreY(b) - centreY(a)) / dx);
      break;
    }
  }
  if (slopes.length < 6) return 0;
  const slope = median(slopes);
  return Math.abs(slope) <= 0.2 ? slope : 0;
}

// A box taller than this many typical word heights is a blob of several lines
// or stray marks, not a word: only its middle part counts when rows are
// matched, so its overhang can't pull in the words of the rows above and below.
const MAX_BOX_HEIGHTS = 2;

// Groups words into visual rows: a word joins the row it overlaps
// vertically by at least half of the shorter height (a box taller than twice
// a typical word counts as only its middle, see above). Words are placed left
// to right, each compared with the word before it in the row and moved along the
// text's tilt — not with the whole row so far, which on a tilted photo grows
// until it swallows the rows above and below. A row's y0/y1 are measured
// level (tilt removed), so rows compare in the same terms wherever their
// words sit. Words in a row are then ordered left to right by position.
function groupRows(words: readonly OcrWord[]): Row[] {
  if (words.length === 0) return [];
  const slope = lineSlope(words);
  const cap = MAX_BOX_HEIGHTS * median(words.map((w) => w.bbox.y1 - w.bbox.y0));
  const middle = (y0: number, y1: number): [number, number] =>
    y1 - y0 > cap ? [(y0 + y1 - cap) / 2, (y0 + y1 + cap) / 2] : [y0, y1];
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const rows: Array<{ words: OcrWord[]; last: BBox }> = [];
  for (const word of sorted) {
    let best: (typeof rows)[number] | undefined;
    let bestRatio = 0.5;
    for (const row of rows) {
      const drift = slope * (centreX(word.bbox) - centreX(row.last));
      const [y0, y1] = middle(row.last.y0 + drift, row.last.y1 + drift);
      const [w0, w1] = middle(word.bbox.y0, word.bbox.y1);
      const ratio = verticalOverlapRatio(
        { ...word.bbox, y0: w0, y1: w1 },
        y0,
        y1,
      );
      if (ratio >= bestRatio) {
        best = row;
        bestRatio = ratio;
      }
    }
    if (best) {
      best.words.push(word);
      best.last = word.bbox;
    } else {
      rows.push({ words: [word], last: word.bbox });
    }
  }
  const centre = median(words.map((w) => centreX(w.bbox)));
  const level = (word: OcrWord) => slope * (centreX(word.bbox) - centre);
  return rows
    .map(({ words: rowWords }) => ({
      words: rowWords.sort((a, b) => a.bbox.x0 - b.bbox.x0),
      y0: Math.min(...rowWords.map((w) => w.bbox.y0 - level(w))),
      y1: Math.max(...rowWords.map((w) => w.bbox.y1 - level(w))),
    }))
    .sort((a, b) => a.y0 - b.y0);
}

// ---------------------------------------------------------------------------
// Tokens

type Token =
  | { kind: 'word'; text: string; arabic: boolean; word: OcrWord }
  | {
      kind: 'number';
      text: string;
      value?: number;
      ambiguous: boolean;
      word: OcrWord;
    }
  | { kind: 'less-than'; text: string; word: OcrWord }
  | { kind: 'percent'; text: string; word: OcrWord };

const ARABIC_LETTER = /[\u0621-\u064A]/;

// Brings Arabic and English label text to one comparable form: Arabic-Indic
// and Persian digits become 0-9, the Arabic decimal separator becomes ".",
// the Arabic thousands separator and comma become ",", the Arabic percent
// sign becomes "%", diacritics and tatweel are dropped, and letter variants
// that labels mix freely (أ/إ/آ, ى/ي, ة/ه) are unified.
export function normalizeLabelText(text: string): string {
  return text
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06f0-\u06f9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/\u066b/g, '.')
    .replace(/[\u066c\u060c]/g, ',')
    .replace(/\u066a/g, '%')
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0629/g, '\u0647')
    .toLowerCase();
}

const TOKEN_PATTERN = /\d+(?:[.,]\d+)*|[a-z]+|[\u0621-\u064a]+|<|%/g;

// One separator: "." or "," is always a decimal point, however many digits
// follow it ("2.5", "2,5", "415.932", "415,932"); labels print three decimals
// routinely, so a three-digit fraction is never taken for a thousands group.
// Two or more separators ("1,046.5") are never read.
export function parseLabelNumber(text: string): {
  value?: number;
  ambiguous: boolean;
} {
  const separators = text.match(/[.,]/g) ?? [];
  // No label prints "02" for two: a whole number with a leading zero is a
  // decimal point lost ("0.2" on a photo with glare), and is never read.
  if (separators.length === 0 && /^0\d/.test(text)) return { ambiguous: true };
  if (separators.length === 0) return { value: Number(text), ambiguous: false };
  if (separators.length > 1) return { ambiguous: true };
  const [whole, fraction] = text.split(/[.,]/);
  return { value: Number(`${whole}.${fraction}`), ambiguous: false };
}

function tokensOfWord(word: OcrWord): Token[] {
  const tokens: Token[] = [];
  for (const match of normalizeLabelText(word.text).matchAll(TOKEN_PATTERN)) {
    const text = match[0];
    if (/^\d/.test(text)) {
      const parsed = parseLabelNumber(text);
      tokens.push({
        kind: 'number',
        text,
        ...parsed,
        ambiguous: parsed.ambiguous || word.numberCheck === 'unverified',
        word,
      });
    } else if (text === '<') {
      tokens.push({ kind: 'less-than', text, word });
    } else if (text === '%') {
      tokens.push({ kind: 'percent', text, word });
    } else {
      tokens.push({
        kind: 'word',
        text,
        arabic: ARABIC_LETTER.test(text),
        word,
      });
    }
  }
  return tokens;
}

type Script = 'arabic' | 'latin';

function scriptOf(tokens: readonly Token[]): Script | undefined {
  if (tokens.some((t) => t.kind === 'word' && t.arabic)) return 'arabic';
  if (tokens.some((t) => t.kind === 'word')) return 'latin';
  return undefined;
}

// Tokens of a row in reading order. Words are positioned left to right, but
// Arabic is read right to left, so each run of Arabic words — with the
// numbers printed between them — is reversed back into reading order.
// "بروتين ٢١ جم" sits on the photo as [جم][21][بروتين] and is read
// [بروتين][21][جم]. A number between an English and an Arabic word belongs
// to neither run and keeps its place. Tokens inside one word keep their
// order ("٢١جم" stays [21][جم]).
const rowTokens = new WeakMap<Row, Token[]>();

function tokenize(row: Row): Token[] {
  const cached = rowTokens.get(row);
  if (cached) return cached;
  const words = row.words.map(tokensOfWord).filter((t) => t.length > 0);
  const own = words.map(scriptOf);
  const resolved = own.map((script, i) => {
    if (script) return script;
    let left: Script | undefined;
    let right: Script | undefined;
    for (let j = i - 1; j >= 0 && !left; j -= 1) left = own[j];
    for (let j = i + 1; j < own.length && !right; j += 1) right = own[j];
    if (left && right) return left === right ? left : undefined;
    return left ?? right;
  });

  const ordered: Token[][] = [];
  for (let i = 0; i < words.length;) {
    if (resolved[i] !== 'arabic') {
      ordered.push(words[i]);
      i += 1;
      continue;
    }
    let j = i;
    while (j < words.length && resolved[j] === 'arabic') j += 1;
    ordered.push(...words.slice(i, j).reverse());
    i = j;
  }
  const tokens = ordered.flat();
  rowTokens.set(row, tokens);
  return tokens;
}

// ---------------------------------------------------------------------------
// Nutrient keywords

interface Keyword {
  tokens: readonly string[];
  // Undefined for nutrients the form has no field for. They are still
  // recognised so they end the previous nutrient's segment and are never
  // mistaken for it — "Saturated fat" must never fill Fat.
  field?: LabelField;
}

const KEYWORDS: readonly Keyword[] = [
  { tokens: ['energy'], field: 'caloriesPer100g' },
  { tokens: ['energy', 'value'], field: 'caloriesPer100g' },
  { tokens: ['total', 'energy'], field: 'caloriesPer100g' },
  { tokens: ['calories'], field: 'caloriesPer100g' },
  { tokens: ['calorie'], field: 'caloriesPer100g' },
  { tokens: ['protein'], field: 'proteinPer100g' },
  { tokens: ['proteins'], field: 'proteinPer100g' },
  { tokens: ['carbohydrate'], field: 'carbsPer100g' },
  { tokens: ['carbohydrates'], field: 'carbsPer100g' },
  { tokens: ['carbs'], field: 'carbsPer100g' },
  { tokens: ['total', 'carbohydrate'], field: 'carbsPer100g' },
  { tokens: ['total', 'carbohydrates'], field: 'carbsPer100g' },
  { tokens: ['fat'], field: 'fatPer100g' },
  { tokens: ['fats'], field: 'fatPer100g' },
  { tokens: ['total', 'fat'], field: 'fatPer100g' },
  { tokens: ['total', 'fats'], field: 'fatPer100g' },
  { tokens: ['saturated', 'fat'] },
  { tokens: ['saturated', 'fats'] },
  { tokens: ['saturated'] },
  { tokens: ['saturates'] },
  { tokens: ['of', 'which', 'saturates'] },
  { tokens: ['trans', 'fat'] },
  { tokens: ['trans', 'fats'] },
  { tokens: ['trans'] },
  { tokens: ['monounsaturated'] },
  { tokens: ['monounsaturated', 'fat'] },
  { tokens: ['monounsaturated', 'fats'] },
  { tokens: ['polyunsaturated'] },
  { tokens: ['polyunsaturated', 'fat'] },
  { tokens: ['polyunsaturated', 'fats'] },
  { tokens: ['unsaturated'] },
  { tokens: ['unsaturated', 'fat'] },
  { tokens: ['unsaturated', 'fats'] },
  { tokens: ['sugar'], field: 'sugarPer100g' },
  { tokens: ['sugars'], field: 'sugarPer100g' },
  { tokens: ['of', 'which', 'sugars'], field: 'sugarPer100g' },
  { tokens: ['total', 'sugars'], field: 'sugarPer100g' },
  // Added sugars are a part of sugars, never the sugars total.
  { tokens: ['added', 'sugars'] },
  { tokens: ['fibre'], field: 'fiberPer100g' },
  { tokens: ['fiber'], field: 'fiberPer100g' },
  { tokens: ['dietary', 'fiber'], field: 'fiberPer100g' },
  { tokens: ['dietary', 'fibre'], field: 'fiberPer100g' },
  // Salt is recognised so it is never read as sodium; salt → sodium is an
  // estimate, not a reading.
  { tokens: ['salt'] },
  { tokens: ['sodium'], field: 'sodiumMgPer100' },
  { tokens: ['serving', 'size'], field: 'servingSize' },
  { tokens: ['portion', 'size'], field: 'servingSize' },
  { tokens: ['net', 'wt'], field: 'packageSize' },
  { tokens: ['net', 'weight'], field: 'packageSize' },
  { tokens: ['net', 'content'], field: 'packageSize' },
  { tokens: ['net', 'contents'], field: 'packageSize' },
  { tokens: ['net', 'quantity'], field: 'packageSize' },
  { tokens: ['net', 'volume'], field: 'packageSize' },
  { tokens: ['net', 'vol'], field: 'packageSize' },
  { tokens: ['cholesterol'] },
  { tokens: ['calcium'] },
  { tokens: ['iron'] },
  { tokens: ['potassium'] },
  { tokens: ['vitamin'] },

  // Arabic, in reading order and normalised (ة→ه, أ/إ/آ→ا, ى→ي).
  { tokens: ['طاقه'], field: 'caloriesPer100g' },
  { tokens: ['الطاقه'], field: 'caloriesPer100g' },
  { tokens: ['سعرات'], field: 'caloriesPer100g' },
  { tokens: ['السعرات'], field: 'caloriesPer100g' },
  { tokens: ['سعرات', 'حراريه'], field: 'caloriesPer100g' },
  { tokens: ['السعرات', 'الحراريه'], field: 'caloriesPer100g' },
  { tokens: ['الطاقه', 'الحراريه'], field: 'caloriesPer100g' },
  { tokens: ['القيمه', 'الحراريه'], field: 'caloriesPer100g' },
  { tokens: ['بروتين'], field: 'proteinPer100g' },
  { tokens: ['البروتين'], field: 'proteinPer100g' },
  { tokens: ['بروتينات'], field: 'proteinPer100g' },
  { tokens: ['البروتينات'], field: 'proteinPer100g' },
  { tokens: ['كربوهيدرات'], field: 'carbsPer100g' },
  { tokens: ['الكربوهيدرات'], field: 'carbsPer100g' },
  { tokens: ['كاربوهيدرات'], field: 'carbsPer100g' },
  { tokens: ['الكاربوهيدرات'], field: 'carbsPer100g' },
  { tokens: ['الكربوهيدرات', 'الكليه'], field: 'carbsPer100g' },
  { tokens: ['مجموع', 'الكربوهيدرات'], field: 'carbsPer100g' },
  { tokens: ['اجمالي', 'الكربوهيدرات'], field: 'carbsPer100g' },
  { tokens: ['نشويات'], field: 'carbsPer100g' },
  { tokens: ['النشويات'], field: 'carbsPer100g' },
  { tokens: ['دهون'], field: 'fatPer100g' },
  { tokens: ['الدهون'], field: 'fatPer100g' },
  { tokens: ['دهون', 'كليه'], field: 'fatPer100g' },
  { tokens: ['الدهون', 'الكليه'], field: 'fatPer100g' },
  { tokens: ['مجموع', 'الدهون'], field: 'fatPer100g' },
  { tokens: ['اجمالي', 'الدهون'], field: 'fatPer100g' },
  { tokens: ['دهون', 'مشبعه'] },
  { tokens: ['الدهون', 'المشبعه'] },
  { tokens: ['منها', 'دهون', 'مشبعه'] },
  { tokens: ['مشبعه'] },
  { tokens: ['دهون', 'متحوله'] },
  { tokens: ['الدهون', 'المتحوله'] },
  { tokens: ['متحوله'] },
  { tokens: ['دهون', 'غير', 'مشبعه'] },
  { tokens: ['الدهون', 'غير', 'المشبعه'] },
  { tokens: ['غير', 'مشبعه'] },
  { tokens: ['احاديه'] },
  { tokens: ['متعدده'] },
  { tokens: ['سكر'], field: 'sugarPer100g' },
  { tokens: ['السكر'], field: 'sugarPer100g' },
  { tokens: ['سكريات'], field: 'sugarPer100g' },
  { tokens: ['السكريات'], field: 'sugarPer100g' },
  { tokens: ['منها', 'سكريات'], field: 'sugarPer100g' },
  { tokens: ['سكريات', 'مضافه'] },
  { tokens: ['الياف'], field: 'fiberPer100g' },
  { tokens: ['الالياف'], field: 'fiberPer100g' },
  { tokens: ['الياف', 'غذائيه'], field: 'fiberPer100g' },
  { tokens: ['الالياف', 'الغذائيه'], field: 'fiberPer100g' },
  { tokens: ['صوديوم'], field: 'sodiumMgPer100' },
  { tokens: ['الصوديوم'], field: 'sodiumMgPer100' },
  { tokens: ['حجم', 'الحصه'], field: 'servingSize' },
  { tokens: ['الوزن', 'الصافي'], field: 'packageSize' },
  { tokens: ['وزن', 'صافي'], field: 'packageSize' },
  { tokens: ['صافي', 'الوزن'], field: 'packageSize' },
  { tokens: ['المحتوي', 'الصافي'], field: 'packageSize' },
  { tokens: ['الحجم', 'الصافي'], field: 'packageSize' },
  { tokens: ['ملح'] },
  { tokens: ['الملح'] },
  { tokens: ['كوليسترول'] },
  { tokens: ['الكوليسترول'] },
  { tokens: ['كالسيوم'] },
  { tokens: ['حديد'] },
  { tokens: ['بوتاسيوم'] },
  { tokens: ['فيتامين'] },
];

function isArabicKeyword(keyword: Keyword): boolean {
  return ARABIC_LETTER.test(keyword.tokens[0]);
}

// Longest keyword starting at token index i, so "saturated fat" wins over
// "fat" and "total carbohydrate" over "carbohydrate".
function keywordAt(
  tokens: readonly Token[],
  i: number,
): { keyword: Keyword; length: number } | undefined {
  let best: { keyword: Keyword; length: number } | undefined;
  for (const keyword of KEYWORDS) {
    const n = keyword.tokens.length;
    if (best && n <= best.length) continue;
    const matches = keyword.tokens.every((t, k) => {
      const token = tokens[i + k];
      return token?.kind === 'word' && token.text === t;
    });
    if (matches) best = { keyword, length: n };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Values

const KCAL_UNITS = new Set([
  'kcal',
  'سعر',
  'سعره',
  'سعرات',
  'كالوري',
  'كالوريز',
  'كيلوكالوري',
]);
const KJ_UNITS = new Set(['kj', 'كيلوجول', 'كجول']);
type Unit = 'g' | 'mg' | 'kcal' | 'kj' | 'kg' | 'ml' | 'l' | 'cl';

// The unit starting at token i, and how many tokens it spans: Arabic
// labels may print kcal and kJ as two words ("كيلو كالوري", "كيلو جول").
function unitAt(
  tokens: readonly Token[],
  i: number,
): { unit: Unit; length: number } | undefined {
  const token = tokens[i];
  if (token?.kind !== 'word') return undefined;
  if (token.text === 'كيلو') {
    const next = tokens[i + 1];
    if (next?.kind !== 'word') return undefined;
    if (['كالوري', 'سعر', 'سعره'].includes(next.text)) {
      return { unit: 'kcal', length: 2 };
    }
    if (next.text === 'جول') return { unit: 'kj', length: 2 };
    if (['جرام', 'غرام'].includes(next.text)) return { unit: 'kg', length: 2 };
    return undefined;
  }
  if (MASS_UNITS.has(token.text)) return { unit: 'g', length: 1 };
  if (MILLIGRAM_UNITS.has(token.text)) return { unit: 'mg', length: 1 };
  if (KCAL_UNITS.has(token.text)) return { unit: 'kcal', length: 1 };
  if (KJ_UNITS.has(token.text)) return { unit: 'kj', length: 1 };
  const quantity = QUANTITY_UNITS[token.text];
  if (quantity) return { unit: quantity, length: 1 };
  return undefined;
}

interface Candidate {
  value?: number;
  unit?: Unit;
  ambiguous: boolean;
  lessThan: boolean;
  // The word the number was printed in, for column placement.
  word: OcrWord;
  // The word its unit was printed in, when it is a separate word.
  unitWord?: OcrWord;
  // The unit read for it is gone: nothing before it or beside it names one,
  // no other word right after it could be an unrecognised unit, and the word
  // just before it is a bracketed scrap where a "(g)" was printed ("(2)", "()").
  unitMisread?: boolean;
}

// Whether a unit word was printed right beside a number: the same word
// ("21g"), or a neighbour on the same line no further than one and a half
// character heights away (a space is well under one). A unit across a column gap belongs to another
// cell and never attaches to this number.
function besideNumber(number: OcrWord, unit: OcrWord): boolean {
  if (number === unit) return true;
  const height = Math.max(
    number.bbox.y1 - number.bbox.y0,
    unit.bbox.y1 - unit.bbox.y0,
  );
  const gap = Math.max(
    unit.bbox.x0 - number.bbox.x1,
    number.bbox.x0 - unit.bbox.x1,
  );
  const sameLine =
    Math.min(number.bbox.y1, unit.bbox.y1) -
      Math.max(number.bbox.y0, unit.bbox.y0) >
    0;
  return sameLine && gap <= 1.5 * height;
}

interface Segment {
  keyword: Keyword;
  keywordWords: OcrWord[];
  tokens: Token[];
  row: Row;
  arabic: boolean;
  // Its value could equally belong to a different nutrient named right
  // after it in Arabic (whose value, read right to left, sits to its left).
  contested?: boolean;
}

// The "(g)" after a row label read as a lone bracketed digit ("(2)"): not a
// value, and not a unit either.
function isUnitMisread(token: Token): boolean {
  return token.kind === 'number' && isBracketedDigit(token.word.text);
}

// Whether the word just before a number is what a misread "(g)" leaves: a
// bracket with at most one letter or digit in it.
function bracketScrapBefore(row: Row, word: OcrWord): boolean {
  const before = row.words[row.words.indexOf(word) - 1];
  if (!before || before.text.length > 4 || !/[()[\]{}]/.test(before.text)) {
    return false;
  }
  return before.text.replace(/[^\p{L}\p{N}]/gu, '').length <= 1;
}

function candidatesIn(segment: Segment): Candidate[] {
  const { tokens } = segment;
  // A unit printed before any number ("Energy (kcal) 250") applies to the
  // segment's bare numbers.
  let defaultUnit: Unit | undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    if (isUnitMisread(tokens[i])) continue;
    if (tokens[i].kind === 'number') break;
    defaultUnit ??= unitAt(tokens, i)?.unit;
  }

  const candidates: Candidate[] = [];
  tokens.forEach((token, i) => {
    if (token.kind !== 'number' || isUnitMisread(token)) return;
    if (isBasisNumber(segment, i)) return;
    const next = tokens[i + 1];
    if (next?.kind === 'percent') return;
    const unit = unitAt(tokens, i + 1);
    const unitWord = tokens[i + 1]?.word;
    const before = tokens
      .slice(Math.max(0, i - 2), i)
      .map((t) => (t.kind === 'word' ? t.text : t.kind));
    const attached =
      unit !== undefined &&
      unitWord !== undefined &&
      besideNumber(token.word, unitWord);
    candidates.push({
      value: token.value,
      unit: attached ? unit.unit : defaultUnit,
      ambiguous: token.ambiguous,
      // "<0.5 g", "less than 0.5 g", "أقل من 0.5 جم" state a bound, not a
      // value.
      lessThan:
        before.at(-1) === 'less-than' ||
        (before[0] === 'less' && before[1] === 'than') ||
        (before[0] === 'اقل' && before[1] === 'من'),
      word: token.word,
      ...(attached && unitWord !== token.word && { unitWord }),
      unitMisread:
        defaultUnit === undefined &&
        unit === undefined &&
        !(next?.kind === 'word' && besideNumber(token.word, next.word)) &&
        bracketScrapBefore(segment.row, token.word),
    });
  });
  return candidates;
}

function isBasisNumber(segment: Segment, i: number): boolean {
  const { tokens } = segment;
  const token = tokens[i];
  if (token.kind !== 'number') return false;
  const nextUnit = unitAt(tokens, i + 1)?.unit;
  const basisUnit = nextUnit === 'g' || nextUnit === 'ml';
  if (isWord(tokens[i - 1], PER_WORDS) && basisUnit) return true;
  const text = normalizeLabelText(token.word.text);
  if (/(?:\/|per|لكل|\(\s*per)\s*\d+\s*(?:g|ml|جم|غ|مل)/.test(text))
    return true;
  if (
    segment.keywordWords.includes(token.word) &&
    (/(?:\(|\/)\s*\d+\s*(?:g|ml|جم|غ|مل)/.test(text) ||
      (token.value === 100 && per100Basis(tokens, i)))
  ) {
    return true;
  }
  const previous = segment.row.words[segment.row.words.indexOf(token.word) - 1];
  if (
    previous &&
    segment.keywordWords.includes(previous) &&
    /^\(\s*\d+\s*(?:g|ml|جم|غ|مل)\s*\)/.test(text)
  ) {
    return true;
  }
  if (
    token.value === 100 &&
    previous &&
    /\/\s*$/.test(previous.text) &&
    basisUnit
  ) {
    return true;
  }
  return false;
}

const rowSegments = new WeakMap<Row, Segment[]>();

function segmentsOf(row: Row): Segment[] {
  const cached = rowSegments.get(row);
  if (cached) return cached;
  const tokens = tokenize(row);
  const segments: Segment[] = [];
  const leading: Token[] = [];
  let i = 0;
  while (i < tokens.length) {
    // A unit word right after a number ("250 سعرات") is that number's
    // unit, not a new "calories" keyword.
    const isUnit =
      tokens[i - 1]?.kind === 'number' && unitAt(tokens, i) !== undefined;
    const match = isUnit ? undefined : keywordAt(tokens, i);
    if (match) {
      segments.push({
        keyword: match.keyword,
        keywordWords: [
          ...new Set(tokens.slice(i, i + match.length).map((t) => t.word)),
        ],
        tokens: [],
        row,
        arabic: isArabicKeyword(match.keyword),
      });
      i += match.length;
      continue;
    }
    const current = segments.at(-1);
    if (current) current.tokens.push(tokens[i]);
    else leading.push(tokens[i]);
    i += 1;
  }

  // A size statement ends where a heading starts: in "Serving size 30 g
  // Per 100 g" the size is 30 g.
  for (const segment of segments) {
    if (!segment.keyword.field || !QUANTITY_FIELDS.has(segment.keyword.field)) {
      continue;
    }
    const end = segment.tokens.findIndex(
      (t) => t.kind === 'word' && PER_WORDS.has(t.text),
    );
    if (end >= 0) segment.tokens.length = end;
  }

  // Values printed before the first keyword belong to it only when it is
  // Arabic: read right to left, an Arabic nutrient's value sits to its
  // left ("21 g بروتين" with an English unit inside Arabic text).
  if (leading.length > 0 && segments[0]?.arabic) {
    segments[0].tokens.unshift(...leading);
  }

  // An English nutrient's values directly followed by a different Arabic
  // nutrient that has no value of its own could belong to either.
  for (let k = 0; k + 1 < segments.length; k += 1) {
    const [english, arabic] = [segments[k], segments[k + 1]];
    if (
      !english.arabic &&
      arabic.arabic &&
      english.keyword.field !== arabic.keyword.field &&
      english.tokens.some((t) => t.kind === 'number') &&
      !arabic.tokens.some((t) => t.kind === 'number')
    ) {
      english.contested = true;
    }
  }
  rowSegments.set(row, segments);
  return segments;
}

function unionBox(words: readonly OcrWord[]): BBox {
  const boxes = words.map((w) => photoBoxes.get(w) ?? w.bbox);
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

function evidenceOf(segment: Segment): LabelEvidence {
  const words = [...new Set(segment.tokens.map((t) => t.word))];
  const rowWords = [...new Set(tokenize(segment.row).map((t) => t.word))];
  return {
    // In reading order, so Arabic text reads naturally.
    rowText: rowWords.map((w) => w.text).join(' '),
    bbox: unionBox(words.length ? words : segment.row.words),
  };
}

const TRACE_WORDS = new Set(['trace', 'traces', 'tr', 'اثار', 'اثر']);

// Below this recognition confidence a number is shown as "needs check"
// rather than "read". A starting value, to be tuned on real labels.
export const MIN_NUMBER_CONFIDENCE = 70;

function checkedConfidence(
  candidate: Candidate,
  reading: LabelReading,
): LabelReading {
  if (candidate.word.confidence >= MIN_NUMBER_CONFIDENCE) return reading;
  return {
    ...reading,
    status: 'needs-check',
    warnings: [...reading.warnings, 'Not printed clearly — check this value.'],
  };
}

const ASSUMED_GRAM_WARNING =
  'Unit not read — assumed g from the per 100 g table. Check this value.';

function unitFits(field: LabelField, unit: Unit | undefined): boolean {
  if (field === 'caloriesPer100g') return unit === 'kcal';
  if (field === 'sodiumMgPer100') return unit === 'mg' || unit === 'g';
  if (QUANTITY_FIELDS.has(field)) {
    return ['g', 'kg', 'ml', 'l', 'cl'].includes(unit ?? '');
  }
  return unit === 'g';
}

function noValue(
  field: LabelField,
  evidence?: LabelEvidence,
  warning?: string,
): LabelReading {
  return {
    field,
    status: 'not-found',
    warnings: warning ? [warning] : [],
    ...(evidence && { evidence }),
  };
}

function readCandidate(
  field: LabelField,
  candidate: Candidate,
  evidence: LabelEvidence,
  options: { fromKilojoules?: boolean; assumedGram?: boolean } = {},
): LabelReading {
  if (candidate.lessThan) {
    return noValue(
      field,
      evidence,
      'Printed as "less than" a value — enter it yourself if needed.',
    );
  }
  if (candidate.ambiguous || candidate.value === undefined) {
    return noValue(field, evidence, "Couldn't read this number clearly.");
  }
  const fromKilojoules =
    options.fromKilojoules &&
    field === 'caloriesPer100g' &&
    candidate.unit === 'kj';
  if (!fromKilojoules && !unitFits(field, candidate.unit)) {
    return noValue(field, evidence);
  }
  const fromGrams = field === 'sodiumMgPer100' && candidate.unit === 'g';
  const value = fromKilojoules
    ? Math.round(candidate.value / 4.184)
    : fromGrams
      ? Number((candidate.value * 1000).toPrecision(12))
      : candidate.value;
  return checkedConfidence(candidate, {
    field,
    value,
    unit:
      fromKilojoules || fromGrams
        ? fromKilojoules
          ? 'kcal'
          : 'mg'
        : candidate.unit,
    status: options.assumedGram ? 'needs-check' : 'read',
    warnings: options.assumedGram ? [ASSUMED_GRAM_WARNING] : [],
    evidence,
    ...(fromKilojoules && { conversion: 'from-kj' }),
    ...(fromGrams && { conversion: 'from-g' }),
  });
}

function readSegment(
  field: LabelField,
  segment: Segment,
  columns: ColumnModel,
): LabelReading {
  const evidence = evidenceOf(segment);
  const notFound = (warning?: string): LabelReading =>
    noValue(field, evidence, warning);

  const isEnergy = field === 'caloriesPer100g';
  const isQuantity = QUANTITY_FIELDS.has(field);
  const servingWarning = servingBasisWarning(segment.tokens);
  if (!isQuantity && servingWarning) return notFound(servingWarning);
  // A value counts as read only with its unit printed next to it (or once
  // before the segment's numbers, "Energy (kcal) 250"), and only a unit that fits
  // the field: kcal for energy, mg or g for sodium, g for the rest of the
  // table; a size needs g, kg, ml, l or cl — never a bare "oz" or "piece".
  // The one exception, grams assumed after a misread "(g)", is handled below
  // and always marked for checking.
  const fits = (c: Candidate) => unitFits(field, c.unit);

  // In a multi-column table only numbers placed in the target column
  // count; a number that straddles two columns can't be placed at all.
  // Sizes have their own rows and are not part of any column.
  const placed = candidatesIn(segment).map((c) => {
    if (isQuantity) return { candidate: c, column: columns.target };
    const column = placeInColumn(c.word.bbox, columns);
    // A unit must sit in the same column as its number.
    const unitColumn = c.unitWord && placeInColumn(c.unitWord.bbox, columns);
    return {
      candidate:
        unitColumn && column !== 'ambiguous' && unitColumn !== column
          ? { ...c, unit: undefined }
          : c,
      column,
    };
  });
  if (placed.some((p) => p.column === 'ambiguous' && fits(p.candidate))) {
    return notFound("Couldn't tell which column this value is in.");
  }
  const candidates = placed
    .filter((p) => p.column === columns.target)
    .map((p) => p.candidate);
  const usable = candidates.filter(fits);
  if (segment.contested && usable.length > 0) {
    return notFound("Couldn't tell which nutrient this value belongs to.");
  }

  if (usable.length === 0) {
    // "Fat: trace" — a word, not a number, and never read as 0.
    const trace = segment.tokens.some(
      (t) =>
        t.kind === 'word' &&
        TRACE_WORDS.has(t.text) &&
        (isQuantity || placeInColumn(t.word.bbox, columns) === columns.target),
    );
    if (trace) {
      return notFound('Printed as “trace” — enter it yourself if needed.');
    }
    const kj = candidates.filter((c) => c.unit === 'kj');
    if (isEnergy && kj.length === 1) {
      return readCandidate(field, kj[0], evidence, { fromKilojoules: true });
    }
    if (isEnergy && kj.length > 1) {
      return notFound('Several values on this row — check the label.');
    }
    // A number with no unit read is never dropped silently. When the unit
    // was printed but misread ("(g)" read as "(2)"), a gram nutrient's lone
    // number on a per 100 g table is taken as grams — flagged, since the unit
    // is assumed — but only a number that passed every other check; no other
    // unit is ever assumed, and a number with no unit printed stays empty.
    const unitless = candidates.filter(
      (c) =>
        c.unit === undefined &&
        c.value !== undefined &&
        !c.ambiguous &&
        !c.lessThan,
    );
    if (unitless.length === 1) {
      const [candidate] = unitless;
      const gramsAssumed =
        candidate.unitMisread &&
        !isQuantity &&
        !segment.contested &&
        GRAM_NUTRIENTS.has(field) &&
        columns.target.kind === 'per100' &&
        columns.target.basis === 'PER_100_G';
      if (gramsAssumed) {
        return readCandidate(field, { ...candidate, unit: 'g' }, evidence, {
          assumedGram: true,
        });
      }
      return notFound("Couldn't read the unit — check this value.");
    }
    return notFound();
  }
  if (usable.length > 1) {
    return notFound('Several values on this row — check the label.');
  }
  const [candidate] = usable;
  return readCandidate(field, candidate, evidence);
}

// ---------------------------------------------------------------------------
// Columns
//
// A nutrition table can carry several value columns — "per 100 g",
// "per serving (30 g)", "%RI". Only a column the label itself heads per
// 100 g / per 100 ml may fill per-100 fields, so the reader finds the
// header phrases, gives each a horizontal position, and places every
// number in the column it sits under.

type ColumnKind = 'per100' | 'serving' | 'percent';

interface Column {
  kind: ColumnKind;
  basis?: NutritionBasis;
  x0: number;
  x1: number;
  center: number;
  // The language the heading is written in.
  script?: Script;
  // A percent heading made of nothing but a "%".
  bare?: boolean;
  explicit?: boolean;
}

interface ColumnModel {
  // Every value column, ordered left to right.
  columns: Column[];
  // The column readings are taken from: the per-100 column, or — on a
  // per-serving-only label — the serving column (reference only).
  target: Column;
}

const BASIS_UNITS: Record<string, NutritionBasis> = {
  g: 'PER_100_G',
  gm: 'PER_100_G',
  gr: 'PER_100_G',
  grams: 'PER_100_G',
  ml: 'PER_100_ML',
  جم: 'PER_100_G',
  جرام: 'PER_100_G',
  غ: 'PER_100_G',
  غم: 'PER_100_G',
  غرام: 'PER_100_G',
  مل: 'PER_100_ML',
  ملل: 'PER_100_ML',
  مليلتر: 'PER_100_ML',
  ملليلتر: 'PER_100_ML',
};

const PER_WORDS = new Set(['per', 'لكل']);

const SERVING_WORDS = new Set([
  'serving',
  'portion',
  'حصه',
  'الحصه',
  'للحصه',
  'وجبه',
]);
// Pack-size and serving-size wording describes a quantity, never a column:
// "Net weight 100 g" is not a per-100 heading.
const NOT_A_HEADING_WORDS = new Set([
  'size',
  'net',
  'weight',
  'wt',
  'content',
  'contents',
  'pack',
  'package',
  'حجم',
  'وزن',
  'الوزن',
  'صافي',
  'الصافي',
  'عبوه',
  'العبوه',
  'محتوي',
  'المحتوي',
]);
const PERCENT_WORDS = new Set([
  'ri',
  'dv',
  'nrv',
  'gda',
  'rda',
  'rdi',
  'اليوميه',
  'المرجعيه',
  'اليومي',
  'المرجعي',
  'الاحتياج',
]);
// Ordinary words that name a percent column only as a pair ("daily value",
// "reference intake") or beside a "%": alone they are just text.
const SOFT_PERCENT_WORDS = new Set(['daily', 'reference', 'intake', 'di']);
const SOFT_PERCENT_PAIRS = new Set([
  'daily value',
  'daily intake',
  'daily reference',
  'reference intake',
  'reference value',
]);

function softPairAt(tokens: readonly Token[], i: number): boolean {
  const [a, b] = [tokens[i], tokens[i + 1]];
  return (
    a?.kind === 'word' &&
    b?.kind === 'word' &&
    SOFT_PERCENT_PAIRS.has(`${a.text} ${b.text}`)
  );
}

// Whether a phrase names a percent column. A bare "%" does so only when
// allowed: a stray "%" read from a pattern or logo above the table must not
// head a column that overlaps the real one.
function isPercentPhrase(tokens: readonly Token[], allowBare: boolean) {
  const percentSign = tokens.some((t) => t.kind === 'percent');
  return (
    tokens.some((t) => isWord(t, PERCENT_WORDS)) ||
    tokens.some((_, i) => softPairAt(tokens, i)) ||
    (percentSign && tokens.some((t) => isWord(t, SOFT_PERCENT_WORDS))) ||
    (percentSign && allowBare)
  );
}
const TABLE_TITLE_WORDS = new Set([
  'nutrition',
  'nutritional',
  'facts',
  'القيمه',
  'الغذائيه',
]);

function isWord(
  token: Token | undefined,
  words: ReadonlySet<string> | string,
): boolean {
  if (token?.kind !== 'word') return false;
  return typeof words === 'string'
    ? token.text === words
    : words.has(token.text);
}

function per100Basis(
  tokens: readonly Token[],
  i: number,
): NutritionBasis | undefined {
  const token = tokens[i];
  if (token?.kind !== 'number' || token.value !== 100) return undefined;
  const next = tokens[i + 1];
  return next?.kind === 'word' ? BASIS_UNITS[next.text] : undefined;
}

function classifyPhrase(
  tokens: readonly Token[],
  allowBarePercent: boolean,
): Column | undefined {
  // "Serving size 30 g" / "Net weight 100 g" state a quantity; they head
  // no column.
  if (tokens.some((t) => isWord(t, NOT_A_HEADING_WORDS))) return undefined;
  const words = tokens.map((t) => t.word);
  const x0 = Math.min(...words.map((w) => w.bbox.x0));
  const x1 = Math.max(...words.map((w) => w.bbox.x1));
  const extent = {
    x0,
    x1,
    center: (x0 + x1) / 2,
    script: scriptOf(tokens),
    explicit: tokens.some((t) => t.kind === 'number' || isWord(t, PER_WORDS)),
  };
  if (isPercentPhrase(tokens, allowBarePercent)) {
    return { kind: 'percent', ...extent };
  }
  if (tokens.some((t) => isWord(t, SERVING_WORDS))) {
    return { kind: 'serving', ...extent };
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const basis = per100Basis(tokens, i);
    if (basis) return { kind: 'per100', basis, ...extent };
  }
  // "per 30 g" heads a serving column.
  if (isWord(tokens[0], PER_WORDS) && tokens.some((t) => t.kind === 'number')) {
    return { kind: 'serving', ...extent };
  }
  return undefined;
}

// Splits a header row into column phrases: a new phrase starts at "per",
// at "serving"/"portion" (unless right after "per"), at a bare "100 g"
// outside a serving or quantity phrase, and at "%" / "RI" / "DV".
function headerPhrases(tokens: readonly Token[]): Column[] {
  const phrases: Token[][] = [];
  tokens.forEach((token, i) => {
    const current = phrases.at(-1);
    // "Serving size 100 g", "Net weight 100 g" and "per serving (100 g)"
    // stay one phrase: their "100 g" never starts a per-100 column.
    const inServing = current?.some(
      (t) => isWord(t, SERVING_WORDS) || isWord(t, NOT_A_HEADING_WORDS),
    );
    const inPercent = current?.some(
      (t) =>
        t.kind === 'percent' ||
        isWord(t, PERCENT_WORDS) ||
        isWord(t, SOFT_PERCENT_WORDS),
    );
    const justPer = current?.length === 1 && isWord(current[0], PER_WORDS);
    // Once a phrase holds a number, words in the other script start a
    // new phrase: "100 g" must not absorb an Arabic table title.
    const lastWord = current
      ?.filter((t): t is Extract<Token, { kind: 'word' }> => t.kind === 'word')
      .at(-1);
    const scriptBreak =
      token.kind === 'word' &&
      lastWord !== undefined &&
      lastWord.arabic !== token.arabic &&
      current?.some((t) => t.kind === 'number');
    const starts =
      !current ||
      scriptBreak ||
      isWord(token, PER_WORDS) ||
      (isWord(token, SERVING_WORDS) && !justPer) ||
      (per100Basis(tokens, i) !== undefined && !justPer && !inServing) ||
      ((token.kind === 'percent' ||
        isWord(token, PERCENT_WORDS) ||
        softPairAt(tokens, i)) &&
        !inPercent);
    if (starts || !current) phrases.push([token]);
    else current.push(token);
  });
  // A heading made only of a bare "%" is marked, so columnModel can drop it
  // when it is noise (see there) and keep it when it heads a real column.
  return phrases
    .map((p): Column | undefined => {
      const strict = classifyPhrase(p, false);
      if (strict) return strict;
      const bare = classifyPhrase(p, true);
      return bare && { ...bare, bare: true };
    })
    .filter((c): c is Column => c !== undefined);
}

interface HeadingColumn extends Column {
  rows: Set<number>;
}

function sameColumnKind(a: Column, b: Column): boolean {
  return a.kind === b.kind && a.basis === b.basis;
}

// Resolves the table's value columns, or nothing when the headings can't be
// trusted. Headings count only above the table — the first row where a
// nutrient has a number (a product name like "PROTEIN BAR" above the
// title is not the table). A new value heading inside or below the table
// (a second table, a per-100 footer) makes the layout unresolved rather
// than letting it re-label values it doesn't head; a "%RI ..." footnote
// is not a value heading.
function columnModel(rows: readonly Row[]): ColumnModel | undefined {
  const isValueRow = (row: Row) =>
    segmentsOf(row).some(
      (s) =>
        s.keyword.field &&
        !QUANTITY_FIELDS.has(s.keyword.field) &&
        candidatesIn(s).length > 0,
    );
  const firstValueRow = rows.find(isValueRow);
  if (!firstValueRow) return undefined;

  const headingRows = rows
    // A row naming a nutrient is a table row, not headings; a size statement
    // may share a row with headings ("Serving size 30 g   Per 100 g").
    .filter((row) =>
      segmentsOf(row).every(
        (s) => s.keyword.field && QUANTITY_FIELDS.has(s.keyword.field),
      ),
    )
    .map((row) => ({ row, phrases: headerPhrases(tokenize(row)) }))
    .filter((h) => h.phrases.length > 0);
  const inTable = headingRows.filter((h) => h.row.y0 >= firstValueRow.y0);
  if (
    inTable.some((h) =>
      h.phrases.some((c) => c.kind !== 'percent' && c.explicit),
    )
  ) {
    return undefined;
  }
  const aboveTable = headingRows.filter((h) => h.row.y0 < firstValueRow.y0);

  // Headings stacked on several lines (or repeated in two languages) are
  // combined by position.
  // Each heading remembers which row it was printed on.
  let headings: HeadingColumn[] = aboveTable.flatMap((h, row) =>
    h.phrases.map((c) => ({ ...c, rows: new Set([row]) })),
  );
  // A bare "%" printed above another kind of heading it overlaps is noise (a
  // stray "%" read from a pattern or logo above the table), not a column:
  // left in, it would overlap the real heading and leave the table
  // unresolved. One that overlaps nothing, or sits on the same row as the
  // heading or below it, stays — then the overlap keeps the layout unresolved.
  const rowTop = (h: HeadingColumn) => aboveTable[[...h.rows][0]].row.y0;
  headings = headings.filter(
    (h) =>
      !h.bare ||
      !headings.some(
        (o) =>
          o.kind !== 'percent' &&
          h.x0 < o.x1 &&
          o.x0 < h.x1 &&
          rowTop(h) < rowTop(o),
      ),
  );

  // Fallback: one explicit "per 100 g" inside a nutrient row ("Energy per
  // 100 g") declares a single per-100 column.
  if (headings.length === 0) {
    const inline: HeadingColumn[] = [];
    for (const row of rows) {
      const tokens = tokenize(row);
      tokens.forEach((_, i) => {
        const basis = per100Basis(tokens, i);
        if (basis && isWord(tokens[i - 1], PER_WORDS)) {
          inline.push({
            kind: 'per100',
            basis,
            x0: 0,
            x1: 0,
            center: 0,
            rows: new Set(),
          });
        }
      });
    }
    if (inline.length !== 1) return undefined;
    headings = inline;
  }

  // A same-kind heading on another row that overlaps a column is that
  // column written twice (stacked, or repeated in a second language), and
  // so is an English and an Arabic heading side by side on one row
  // ("Per 100 g لكل 100 جم"). Same-language headings side by side on one
  // row are two columns — "Per 100 g as sold | Per 100 g prepared" —
  // however close, and stay separate. Headings of different kinds that
  // overlap can't be told apart.
  const columns: HeadingColumn[] = [];
  for (const heading of [...headings].sort((a, b) => a.center - b.center)) {
    const previous = columns.at(-1);
    const overlaps = previous !== undefined && heading.x0 < previous.x1;
    const stacked =
      previous !== undefined &&
      [...heading.rows].every((row) => !previous.rows.has(row));
    // On one row, an English and an Arabic heading of the same kind printed
    // right next to each other ("Per 100 g لكل 100 جم") are one heading in
    // two languages. Far apart, they may head separate columns (as sold /
    // prepared), so they stay separate and the layout is unresolved.
    const gap = previous ? heading.x0 - previous.x1 : 0;
    const narrower = previous
      ? Math.min(previous.x1 - previous.x0, heading.x1 - heading.x0)
      : 0;
    const translation =
      previous !== undefined &&
      !stacked &&
      previous.script !== undefined &&
      heading.script !== undefined &&
      previous.script !== heading.script &&
      gap < narrower / 2;
    if (
      previous &&
      sameColumnKind(previous, heading) &&
      ((overlaps && stacked) || translation)
    ) {
      previous.x0 = Math.min(previous.x0, heading.x0);
      previous.x1 = Math.max(previous.x1, heading.x1);
      previous.center = (previous.x0 + previous.x1) / 2;
      for (const row of heading.rows) previous.rows.add(row);
      if (previous.script !== heading.script) previous.script = undefined;
    } else if (overlaps) {
      return undefined;
    } else {
      columns.push({ ...heading });
    }
  }

  // A bilingual table title states one basis for the whole table, even
  // when its translations sit far apart. Require matching bases, different
  // scripts and title words on a shared row, with no other value columns.
  if (columns.length === 2) {
    const [a, b] = columns;
    const titleRow = [...a.rows].some(
      (row) =>
        b.rows.has(row) &&
        tokenize(aboveTable[row].row).some((t) => isWord(t, TABLE_TITLE_WORDS)),
    );
    if (
      titleRow &&
      a.kind === 'per100' &&
      sameColumnKind(a, b) &&
      a.script !== undefined &&
      b.script !== undefined &&
      a.script !== b.script
    ) {
      const x0 = Math.min(a.x0, b.x0);
      const x1 = Math.max(a.x1, b.x1);
      columns.splice(0, 2, {
        ...a,
        x0,
        x1,
        center: (x0 + x1) / 2,
        script: undefined,
        rows: new Set([...a.rows, ...b.rows]),
      });
    }
  }

  const per100 = columns.filter((c) => c.kind === 'per100');
  const serving = columns.filter((c) => c.kind === 'serving');
  if (per100.length === 1) return { columns, target: per100[0] };
  if (per100.length === 0 && serving.length === 1) {
    return { columns, target: serving[0] };
  }
  return undefined;
}

// The column a number sits under: boundaries lie halfway between adjacent
// column centres. A number whose word straddles a boundary by more than a
// quarter of its width on each side can't be placed.
function placeInColumn(box: BBox, model: ColumnModel): Column | 'ambiguous' {
  const { columns } = model;
  if (columns.length === 1) return columns[0];
  const width = Math.max(1, box.x1 - box.x0);
  for (let i = 0; i < columns.length - 1; i += 1) {
    const boundary = (columns[i].center + columns[i + 1].center) / 2;
    if (boundary - box.x0 > width / 4 && box.x1 - boundary > width / 4) {
      return 'ambiguous';
    }
  }
  const center = (box.x0 + box.x1) / 2;
  let index = 0;
  while (
    index < columns.length - 1 &&
    center > (columns[index].center + columns[index + 1].center) / 2
  ) {
    index += 1;
  }
  return columns[index];
}

// ---------------------------------------------------------------------------

const SALT_WORDS = new Set(['salt', 'ملح', 'الملح']);

// Sodium is never worked out from salt: a label that prints salt and no
// sodium row leaves sodium empty, with a note saying why.
function withSaltNote(reading: LabelReading, onlySaltPrinted: boolean) {
  if (
    reading.field !== 'sodiumMgPer100' ||
    reading.value !== undefined ||
    !onlySaltPrinted
  ) {
    return reading;
  }
  return {
    ...reading,
    warnings: [
      ...reading.warnings,
      'Only salt is printed — sodium isn’t calculated from salt.',
    ],
  };
}

const MASS_QUANTITY_UNITS = new Set(['g', 'kg']);
const VOLUME_QUANTITY_UNITS = new Set(['ml', 'l', 'cl']);

// A serving or package size in the other dimension than the label's basis
// (a ml serving on a per 100 g label) is flagged for the user to check.
function withQuantityChecks(
  reading: LabelReading,
  basis: NutritionBasis | undefined,
): LabelReading {
  if (!QUANTITY_FIELDS.has(reading.field) || reading.value === undefined) {
    return reading;
  }
  const unit = reading.unit ?? '';
  const conflict =
    (basis === 'PER_100_G' && VOLUME_QUANTITY_UNITS.has(unit)) ||
    (basis === 'PER_100_ML' && MASS_QUANTITY_UNITS.has(unit));
  if (!conflict) return reading;
  return {
    ...reading,
    status: 'needs-check',
    warnings: [
      ...reading.warnings,
      `This is in ${unit}, but the label’s values are per 100 ${basis === 'PER_100_G' ? 'g' : 'ml'} — check it.`,
    ],
  };
}

const SINGLE_COLUMN: Column = { kind: 'per100', x0: 0, x1: 0, center: 0 };

const NO_PER_100_MESSAGE =
  "Couldn't find a single per 100 g or per 100 ml column — enter per-100 values manually.";

function unresolvedResult(
  readings: LabelReading[] = LABEL_FIELDS.map((field) => noValue(field)),
): LabelScanResult {
  return {
    outcome: 'no-per-100-column',
    readings,
    warnings: [NO_PER_100_MESSAGE],
  };
}

function successfulResult(
  readings: LabelReading[],
  basisSuggestion: NutritionBasis | undefined,
  tableWords: readonly OcrWord[],
): LabelScanResult {
  const checked = withPlausibilityChecks(
    readings,
    basisSuggestion ?? 'PER_100_G',
  );
  const macrosRead = checked.filter(
    (reading) =>
      REQUIRED_MACROS.has(reading.field) && reading.status === 'read',
  ).length;
  const confidence =
    tableWords.reduce((sum, word) => sum + word.confidence, 0) /
    Math.max(1, tableWords.length);
  const weakScan = macrosRead < 2 || confidence < MIN_TABLE_CONFIDENCE;
  return {
    outcome: 'ok',
    basisSuggestion,
    readings: checked,
    warnings: weakScan ? [WEAK_SCAN_MESSAGE] : [],
    ...(weakScan && { weakScan }),
  };
}

interface TransposedHeading {
  field?: LabelField;
  segment: Segment;
  box: BBox;
  center: number;
  arabic?: Segment;
  ambiguous?: boolean;
}

function wordsBox(words: readonly OcrWord[]): BBox {
  const boxes = words.map((word) => word.bbox);
  return {
    x0: Math.min(...boxes.map((box) => box.x0)),
    y0: Math.min(...boxes.map((box) => box.y0)),
    x1: Math.max(...boxes.map((box) => box.x1)),
    y1: Math.max(...boxes.map((box) => box.y1)),
  };
}

function keywordBox(segment: Segment): BBox {
  return wordsBox(segment.keywordWords);
}

function headingBox(segment: Segment): BBox {
  const words = new Set(segment.keywordWords);
  segment.tokens.forEach((token, i) => {
    if (token.kind !== 'number' || !isBasisNumber(segment, i)) return;
    words.add(token.word);
    const before = segment.tokens[i - 1];
    if (isWord(before, PER_WORDS)) words.add(before.word);
    const after = segment.tokens[i + 1];
    if (after && unitAt(segment.tokens, i + 1)) words.add(after.word);
    const previous =
      segment.row.words[segment.row.words.indexOf(token.word) - 1];
    if (previous && /\/\s*$/.test(previous.text)) words.add(previous);
  });
  return wordsBox([...words]);
}

function headingBasis(segment: Segment): NutritionBasis | undefined {
  return segment.tokens.reduce<NutritionBasis | undefined>(
    (basis, _, i) => basis ?? per100Basis(segment.tokens, i),
    undefined,
  );
}

function headingUnit(segment: Segment): Unit | undefined | 'ambiguous' {
  const units = new Set<Unit>();
  segment.tokens.forEach((_, i) => {
    const unit = unitAt(segment.tokens, i)?.unit;
    const before = segment.tokens[i - 1];
    if (unit && !(before?.kind === 'number' && isBasisNumber(segment, i - 1))) {
      units.add(unit);
    }
  });
  if (
    segment.keyword.field === 'caloriesPer100g' &&
    segment.keyword.tokens.includes('سعرات')
  ) {
    units.add('kcal');
  }
  return units.size > 1 ? 'ambiguous' : [...units][0];
}

function arabicPhraseBox(segment: Segment, peers: readonly Segment[]): BBox {
  const box = keywordBox(segment);
  const next = Math.min(
    ...peers
      .filter((peer) => peer !== segment && keywordBox(peer).x0 > box.x0)
      .map((peer) => keywordBox(peer).x0),
  );
  const qualifiers = segment.row.words.filter((word) => {
    if (word.bbox.x0 < box.x1 || word.bbox.x1 > next) return false;
    if (peers.some((peer) => peer.keywordWords.includes(word))) return false;
    const tokens = tokensOfWord(word);
    return !tokens.some((_, i) => unitAt(tokens, i));
  });
  return wordsBox([...segment.keywordWords, ...qualifiers]);
}

function arabicUnitWords(
  heading: TransposedHeading,
  headings: readonly TransposedHeading[],
): OcrWord[] {
  if (!heading.arabic) return [];
  const peers = headings
    .map((candidate) => ({
      heading: candidate,
      segment:
        candidate.arabic ??
        (candidate.segment.arabic ? candidate.segment : undefined),
    }))
    .filter(
      (
        candidate,
      ): candidate is { heading: TransposedHeading; segment: Segment } =>
        candidate.segment?.row === heading.arabic?.row,
    );
  const peerSegments = peers.map((peer) => peer.segment);
  return heading.arabic.row.words.filter((word) => {
    const tokens = tokensOfWord(word);
    if (!tokens.some((_, i) => unitAt(tokens, i))) return false;
    const ranked = peers.map((peer) => {
      const box = arabicPhraseBox(peer.segment, peerSegments);
      const overlap = Math.max(
        0,
        Math.min(box.x1, word.bbox.x1) - Math.max(box.x0, word.bbox.x0),
      );
      const gap = Math.max(box.x0 - word.bbox.x1, word.bbox.x0 - box.x1, 0);
      return { peer, overlap, gap };
    });
    const largestOverlap = Math.max(...ranked.map((item) => item.overlap));
    const closestGap = Math.min(...ranked.map((item) => item.gap));
    const owners = ranked.filter((item) =>
      largestOverlap > 0
        ? item.overlap === largestOverlap
        : item.gap === closestGap,
    );
    return owners.length === 1 && owners[0].peer.heading === heading;
  });
}

function arabicBandUnit(
  heading: TransposedHeading,
  headings: readonly TransposedHeading[],
): Unit | undefined | 'ambiguous' {
  if (!heading.arabic) return undefined;
  const units = new Set<Unit>();
  for (const word of arabicUnitWords(heading, headings)) {
    const tokens = tokensOfWord(word);
    tokens.forEach((_, i) => {
      const unit = unitAt(tokens, i)?.unit;
      const basisNumber = tokens[i - 1];
      if (
        unit &&
        !(
          basisNumber?.kind === 'number' &&
          /(?:\/|per|لكل)\s*\d+/.test(normalizeLabelText(word.text))
        )
      ) {
        units.add(unit);
      }
    });
  }
  return units.size > 1 ? 'ambiguous' : [...units][0];
}

function transposedHeadings(
  rows: readonly Row[],
  start: number,
  height: number,
) {
  const isNutrient = (segment: Segment) =>
    !(segment.keyword.field && QUANTITY_FIELDS.has(segment.keyword.field));
  if (!segmentsOf(rows[start]).some(isNutrient)) {
    return [];
  }
  const source = [rows[start]];
  const next = rows[start + 1];
  if (next && next.y0 - rows[start].y1 <= height) source.push(next);
  if (
    source.some((row) => segmentsOf(row).some((s) => candidatesIn(s).length))
  ) {
    return [];
  }
  const primary = segmentsOf(rows[start]).filter(isNutrient);
  const selected = [...primary];
  for (const segment of source
    .slice(1)
    .flatMap(segmentsOf)
    .filter(isNutrient)) {
    const box = keywordBox(segment);
    const overlaps = primary.some((main) => {
      const other = keywordBox(main);
      const overlap = Math.min(box.x1, other.x1) - Math.max(box.x0, other.x0);
      return overlap >= Math.min(box.x1 - box.x0, other.x1 - other.x0) / 2;
    });
    if (!overlaps && !segment.arabic) {
      selected.push(segment);
    }
  }
  const headings = selected
    .map((segment): TransposedHeading => {
      const box = keywordBox(segment);
      return {
        field: segment.keyword.field,
        segment,
        box,
        center: centreX(box),
      };
    })
    .sort((a, b) => a.center - b.center);
  if (headings.length < 2) return [];
  if (
    new Set(headings.map((h) => h.field ?? h.segment.keyword.tokens.join(' ')))
      .size !== headings.length ||
    headings.some((h, i) => i > 0 && h.box.x0 < headings[i - 1].box.x1)
  ) {
    return [];
  }
  const title = rows[start - 1];
  const titlePer100 =
    title &&
    rows[start].y0 - title.y1 <= 2 * height &&
    headerPhrases(tokenize(title)).some((phrase) => phrase.kind === 'per100');
  const ownEvidence = headings.filter(
    (heading) => headingBasis(heading.segment) || headingUnit(heading.segment),
  ).length;
  if (ownEvidence < 2 && !titlePer100) return [];
  return headings;
}

type TransposedPlacement =
  number | 'outside' | { between: readonly [number, number] };

function placeInTransposedBand(
  box: BBox,
  columns: ColumnModel,
  typicalGap: number,
): TransposedPlacement {
  const { columns: bands } = columns;
  if (
    box.x0 < bands[0].center - typicalGap / 2 ||
    box.x1 > bands[bands.length - 1].center + typicalGap / 2
  ) {
    return 'outside';
  }
  const width = Math.max(1, box.x1 - box.x0);
  for (let i = 0; i < bands.length - 1; i += 1) {
    const boundary = (bands[i].center + bands[i + 1].center) / 2;
    if (boundary - box.x0 > width / 4 && box.x1 - boundary > width / 4) {
      return { between: [i, i + 1] };
    }
  }
  const column = placeInColumn(box, columns);
  return column === 'ambiguous' ? 'outside' : bands.indexOf(column);
}

function servingBasisWarning(tokens: readonly Token[]): string | undefined {
  if (tokens.some((token) => isWord(token, SERVING_WORDS))) {
    return 'This row is per serving — enter per-100 values manually.';
  }
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.kind !== 'number' || token.value === 100) continue;
    const unit = unitAt(tokens, i + 1)?.unit;
    if (!unit || !['g', 'ml', 'kg', 'l', 'cl'].includes(unit)) continue;
    const attachedBasis = /(?:\/|\()\s*(?:per\s*)?\d+\s*(?:g|ml|جم|غ|مل)/.test(
      normalizeLabelText(token.word.text),
    );
    if (isWord(tokens[i - 1], PER_WORDS) || attachedBasis) {
      return `This row is per ${token.value} ${unit} — enter per-100 values manually.`;
    }
  }
  return undefined;
}

const BOUND_WORDS = new Set(['less', 'than', 'اقل', 'من']);

function isProseWord(word: OcrWord): boolean {
  if (/\d|[٠-٩۰-۹]/.test(word.text)) return false;
  const normalized = normalizeLabelText(word.text);
  return /[a-zء-ي]/.test(normalized) && !BOUND_WORDS.has(normalized);
}

function transposedPass(rows: readonly Row[]): LabelScanResult | undefined {
  if (rows.length < 3) return undefined;
  const height = median(
    rows.flatMap((row) => row.words.map((w) => w.bbox.y1 - w.bbox.y0)),
  );
  const first = rows.findIndex(
    (_, i) => transposedHeadings(rows, i, height).length >= 2,
  );
  if (first < 0) return undefined;
  const headings = transposedHeadings(rows, first, height);
  const headingEnd = Math.max(...headings.map((h) => h.segment.row.y1));
  const valueIndex = rows.findIndex(
    (row) =>
      row.y0 >= headingEnd + height / 2 &&
      row.words.some((word) => /\d|[٠-٩۰-۹]/.test(word.text)),
  );
  if (valueIndex < 0) return undefined;
  const valueRow = rows[valueIndex];
  const subheadingRows = rows
    .slice(first, valueIndex)
    .filter((row) =>
      segmentsOf(row).some(
        (segment) => segment.arabic && segment.keyword.field,
      ),
    );
  const lastHeadingEnd = Math.max(
    headingEnd,
    ...subheadingRows.map((row) => row.y1),
  );
  // A distant prose number is not the next line of table cells.
  if (valueRow.y0 - lastHeadingEnd > 2.5 * height) return undefined;
  if (
    valueRow.words.some(isProseWord) ||
    rows.some(
      (row, i) =>
        i > first && i < valueIndex && row.y0 >= lastHeadingEnd + height / 2,
    )
  ) {
    return undefined;
  }

  const blank = (field: LabelField): LabelReading => noValue(field);
  const unresolved = () => unresolvedResult();
  const titleRows = rows
    .slice(0, first)
    .filter((row) => rows[first].y0 - row.y1 <= 3 * height);
  const servingWarning = [...titleRows, ...rows.slice(first, valueIndex)]
    .map((row) => servingBasisWarning(tokenize(row)))
    .find((warning) => warning !== undefined);
  if (servingWarning) {
    return unresolvedResult(
      LABEL_FIELDS.map((field) => noValue(field, undefined, servingWarning)),
    );
  }
  for (const row of rows.slice(valueIndex + 1)) {
    if (row.words.some(isProseWord)) {
      break;
    }
    if (row.words.some((word) => /\d|[٠-٩۰-۹]/.test(word.text))) {
      return unresolved();
    }
  }
  if (
    rows.some(
      (_, i) =>
        i > valueIndex && transposedHeadings(rows, i, height).length >= 2,
    )
  ) {
    return unresolved();
  }

  const titleBases = new Set(
    titleRows
      .flatMap((row) => headerPhrases(tokenize(row)))
      .filter((column) => column.kind === 'per100')
      .map((column) => column.basis),
  );
  if (titleBases.size > 1) return unresolved();
  const titleBasis = [...titleBases][0];
  const headingBases = new Set(
    headings.map((heading) => headingBasis(heading.segment)).filter(Boolean),
  );
  if (!titleBasis && headingBases.size !== 1) return unresolved();
  const basis = titleBasis ?? [...headingBases][0];
  if (!basis) return unresolved();
  const westernCells = valueRow.words.filter(
    (word) => /\d/.test(word.text) && !/[٠-٩۰-۹]/.test(word.text),
  );
  if (westernCells.length !== headings.length) return unresolved();

  const arabic = rows
    .slice(first, valueIndex)
    .flatMap(segmentsOf)
    .filter(
      (segment) =>
        segment.arabic &&
        segment.keyword.field &&
        !headings.some((heading) => heading.segment === segment),
    );
  let unmatchedArabic = false;
  for (const segment of arabic) {
    const box = keywordBox(segment);
    const matches = headings.filter((heading) => {
      const overlap =
        Math.min(box.x1, heading.box.x1) - Math.max(box.x0, heading.box.x0);
      return (
        overlap >=
        Math.min(box.x1 - box.x0, heading.box.x1 - heading.box.x0) / 2
      );
    });
    if (matches.length > 1)
      matches.forEach((heading) => (heading.ambiguous = true));
    if (matches.length === 0) unmatchedArabic = true;
    if (matches.length === 1) {
      const heading = matches[0];
      if (heading.arabic || segment.keyword.field !== heading.field) {
        heading.ambiguous = true;
      } else {
        heading.arabic = segment;
      }
    }
  }
  if (unmatchedArabic) return unresolved();

  const columns: Column[] = headings.map((heading) => ({
    kind: 'per100',
    center: heading.center,
    x0: heading.box.x0,
    x1: heading.box.x1,
  }));
  const model: ColumnModel = { columns, target: columns[0] };
  const typicalGap = median(
    columns.slice(1).map((column, i) => column.center - columns[i].center),
  );
  const headingSpans = headings.map((heading) => {
    const english = headingBox(heading.segment);
    const arabic = heading.arabic && keywordBox(heading.arabic);
    return arabic && arabic.x1 - arabic.x0 > english.x1 - english.x0
      ? arabic
      : english;
  });
  const cells: OcrWord[][] = headings.map(() => []);
  const straddled = new Set<number>();
  for (const word of valueRow.words) {
    if (/[٠-٩۰-۹]/.test(word.text)) continue;
    const placement = placeInTransposedBand(word.bbox, model, typicalGap);
    if (typeof placement === 'number') cells[placement].push(word);
    if (typeof placement === 'object' && /\d/.test(word.text)) {
      placement.between.forEach((index) => straddled.add(index));
    }
  }

  const readings = LABEL_FIELDS.map((field): LabelReading => {
    const index = headings.findIndex((heading) => heading.field === field);
    if (index < 0) return blank(field);
    const heading = headings[index];
    const cellWords = cells[index];
    const evidence: LabelEvidence = {
      rowText: valueRow.words.map((word) => word.text).join(' '),
      bbox: unionBox([...heading.segment.keywordWords, ...cellWords]),
    };
    if (straddled.has(index)) {
      return noValue(
        field,
        evidence,
        "Couldn't tell which column this value is in.",
      );
    }
    if (heading.ambiguous) return noValue(field, evidence);
    const ownBasis = headingBasis(heading.segment);
    if (ownBasis && ownBasis !== basis) return noValue(field, evidence);
    const englishUnit = heading.segment.arabic
      ? arabicBandUnit({ ...heading, arabic: heading.segment }, headings)
      : headingUnit(heading.segment);
    const arabicUnit = heading.segment.arabic
      ? undefined
      : arabicBandUnit(heading, headings);
    if (
      englishUnit === 'ambiguous' ||
      arabicUnit === 'ambiguous' ||
      (englishUnit && arabicUnit && englishUnit !== arabicUnit)
    ) {
      return noValue(field, evidence);
    }
    let unit = englishUnit || arabicUnit;
    const assumedGram =
      !unit &&
      GRAM_NUTRIENTS.has(field) &&
      basis === 'PER_100_G' &&
      ownBasis === 'PER_100_G';
    if (assumedGram) unit = 'g';
    if (!unitFits(field, unit)) return noValue(field, evidence);

    const westernNumberWords = cellWords.filter((word) => /\d/.test(word.text));
    if (westernNumberWords.length === 0) return noValue(field, evidence);
    const headingSpan = headingSpans[index];
    const leftBoundary =
      index === 0
        ? -Infinity
        : (headingSpans[index - 1].x1 + headingSpan.x0) / 2;
    const rightBoundary =
      index === headings.length - 1
        ? Infinity
        : (headingSpan.x1 + headingSpans[index + 1].x0) / 2;
    const allowedLeft = Math.max(headingSpan.x0 - typicalGap / 4, leftBoundary);
    const allowedRight = Math.min(
      headingSpan.x1 + typicalGap / 4,
      rightBoundary,
    );
    if (
      westernNumberWords.some((word) => {
        const center = centreX(word.bbox);
        return center < allowedLeft || center > allowedRight;
      })
    ) {
      return noValue(
        field,
        evidence,
        "Couldn't tell which nutrient this value belongs to.",
      );
    }
    if (westernNumberWords.length > 1) {
      return noValue(
        field,
        evidence,
        'Several values on this row — check the label.',
      );
    }
    const cellRow: Row = { words: cellWords, y0: valueRow.y0, y1: valueRow.y1 };
    const cellSegment: Segment = {
      keyword: heading.segment.keyword,
      keywordWords: [],
      tokens: tokenize(cellRow),
      row: cellRow,
      arabic: false,
    };
    const candidates = candidatesIn(cellSegment);
    if (candidates.length === 0) return noValue(field, evidence);
    if (candidates.length > 1) {
      return noValue(
        field,
        evidence,
        'Several values on this row — check the label.',
      );
    }
    const candidate = candidates[0];
    if (candidate.unit && candidate.unit !== unit)
      return noValue(field, evidence);
    return readCandidate(field, { ...candidate, unit }, evidence, {
      assumedGram,
    });
  });
  const tableWords = [
    ...headings.flatMap((heading) => heading.segment.row.words),
    ...valueRow.words,
  ];
  return successfulResult(readings, basis, tableWords);
}

export function readLabel(layout: OcrLayout): LabelScanResult {
  const rows = groupRows(inReadingSpace(layout.words));
  const transposed = transposedPass(rows);
  if (transposed) return transposed;
  const model = columnModel(rows);
  // Without a usable header the values are still read as one column so
  // they can be shown for reference; the outcome keeps them out of the form.
  const columns: ColumnModel = model ?? {
    columns: [SINGLE_COLUMN],
    target: SINGLE_COLUMN,
  };

  const segmentsByField = new Map<LabelField, Segment[]>();
  let saltPrinted = false;
  for (const row of rows) {
    for (const segment of segmentsOf(row)) {
      const { field } = segment.keyword;
      if (SALT_WORDS.has(segment.keyword.tokens.at(-1) ?? '')) {
        saltPrinted ||= segment.tokens.some((t) => t.kind === 'number');
      }
      if (!field) continue;
      segmentsByField.set(field, [
        ...(segmentsByField.get(field) ?? []),
        segment,
      ]);
    }
  }

  const readings = LABEL_FIELDS.map((field): LabelReading => {
    const segments = segmentsByField.get(field) ?? [];
    if (segments.length === 0) {
      return { field, status: 'not-found', warnings: [] };
    }
    const found = segments.map((segment) => ({
      segment,
      reading: readSegment(field, segment, columns),
    }));
    const valued = found.filter((f) => f.reading.value !== undefined);
    if (valued.length === 0) {
      return (found.find((f) => f.reading.warnings.length > 0) ?? found[0])
        .reading;
    }
    const values = [...new Set(valued.map((f) => f.reading.value as number))];
    const languages = new Set(valued.map((f) => f.segment.arabic));
    if (values.length > 1) {
      return {
        field,
        status: 'not-found',
        warnings: [
          languages.size > 1
            ? `The English and Arabic text disagree (${values.join(' / ')}) — check the label.`
            : 'The label shows different values for this — check it.',
        ],
        evidence: valued[0].reading.evidence,
        conflictingValues: values,
      };
    }
    // Agreeing readings: the clearest one represents them.
    const best = valued.find((f) => f.reading.status === 'read') ?? valued[0];
    return languages.size > 1
      ? { ...best.reading, confirmedInBothLanguages: true }
      : best.reading;
  }).map((reading) =>
    withQuantityChecks(
      withSaltNote(
        reading,
        saltPrinted && !segmentsByField.has('sodiumMgPer100'),
      ),
      model?.target.kind === 'per100' ? model.target.basis : undefined,
    ),
  );

  if (!model) {
    return unresolvedResult(readings);
  }
  if (model.target.kind === 'serving') {
    return {
      outcome: 'per-serving-only',
      readings,
      warnings: [
        'This label lists per-serving values only — enter per-100 values manually.',
      ],
    };
  }

  // Only the nutrient rows count: clear size statements must not lift a
  // poorly recognised table above the threshold.
  const tableWords = rows
    .filter((row) =>
      segmentsOf(row).some(
        (s) => s.keyword.field && !QUANTITY_FIELDS.has(s.keyword.field),
      ),
    )
    .flatMap((row) => row.words);
  return successfulResult(readings, model.target.basis, tableWords);
}

// ---------------------------------------------------------------------------
// Plausibility

const REQUIRED_MACROS: ReadonlySet<LabelField> = new Set([
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'fatPer100g',
]);
// Each macro may be rounded on the label (to 0.1 g or a whole gram), so
// three rounded values can sum slightly above 100 g per 100 g; above this
// allowance the total is not possible.
export const MACRO_SUM_ROUNDING_ALLOWANCE = 1;

// How far printed energy may be from an estimate: 15% of the estimate,
// but never less than 10 kcal (small values round coarsely).
export function energyTolerance(estimate: number): number {
  return Math.max(10, 0.15 * estimate);
}

const GRAM_NUTRIENTS: ReadonlySet<LabelField> = new Set([
  'proteinPer100g',
  'carbsPer100g',
  'sugarPer100g',
  'fatPer100g',
  'fiberPer100g',
]);
// Below this average recognition confidence of the table's words a scan is
// weak. A starting value, to be tuned on real labels.
const MIN_TABLE_CONFIDENCE = 60;

// The most a per-100 value can physically be. On a per-100 g label no
// nutrient can exceed 100 g and energy can't exceed pure fat (~900 kcal);
// grams per 100 ml can exceed 100 (syrups are denser than water), so the
// liquid bound is loose.
function upperBound(
  field: LabelField,
  basis: NutritionBasis,
): number | undefined {
  if (GRAM_NUTRIENTS.has(field)) return basis === 'PER_100_G' ? 100 : 200;
  if (field === 'caloriesPer100g') return basis === 'PER_100_G' ? 900 : 950;
  if (field === 'sodiumMgPer100') return 40000;
  return undefined;
}

function flag(reading: LabelReading, warning: string): LabelReading {
  if (reading.value === undefined || reading.status === 'not-found') {
    return reading;
  }
  return {
    ...reading,
    status: 'needs-check',
    warnings: reading.warnings.includes(warning)
      ? reading.warnings
      : [...reading.warnings, warning],
  };
}

// Checks the readings against each other and against what a label can
// physically say. An impossible value is rejected (left empty); values
// that are possible but don't fit together are kept and marked "needs
// check" — never silently corrected.
function withPlausibilityChecks(
  readings: readonly LabelReading[],
  basis: NutritionBasis,
): LabelReading[] {
  const per = basis === 'PER_100_G' ? '100 g' : '100 ml';
  let checked = readings.map((reading): LabelReading => {
    const bound = upperBound(reading.field, basis);
    if (reading.value === undefined || bound === undefined) return reading;
    if (reading.value <= bound) return reading;
    return {
      field: reading.field,
      status: 'not-found',
      warnings: [
        `${reading.value} ${reading.unit ?? ''} per ${per} isn’t possible — check the label.`,
      ],
      ...(reading.evidence && { evidence: reading.evidence }),
    };
  });

  const value = (field: LabelField) =>
    checked.find((r) => r.field === field && r.status !== 'not-found')?.value;
  const mark = (fields: readonly LabelField[], warning: string) => {
    checked = checked.map((r) =>
      fields.includes(r.field) ? flag(r, warning) : r,
    );
  };

  const carbs = value('carbsPer100g');
  const sugars = value('sugarPer100g');
  // Rounding on the label can make sugars a little above carbs, no more.
  if (carbs !== undefined && sugars !== undefined && sugars > carbs + 0.5) {
    mark(
      ['sugarPer100g', 'carbsPer100g'],
      'Sugars are more than carbs — check these values.',
    );
  }

  const protein = value('proteinPer100g');
  const fat = value('fatPer100g');
  if (
    basis === 'PER_100_G' &&
    protein !== undefined &&
    carbs !== undefined &&
    fat !== undefined &&
    protein + carbs + fat > 100 + MACRO_SUM_ROUNDING_ALLOWANCE
  ) {
    mark(
      ['proteinPer100g', 'carbsPer100g', 'fatPer100g'],
      `Protein, carbs and fat add up to more than 100 g per ${per} — check them.`,
    );
  }

  // Energy should match 4 kcal/g protein and carbs and 9 kcal/g fat.
  // Fibre may count anywhere from 0 to 2 kcal/g, and may be printed inside
  // carbs (US convention) or beside them (EU convention), so the expected
  // energy is a range: from all-of-fibre-inside-carbs-at-0 up to
  // fibre-beside-carbs-at-2. Printed energy must fall within that range
  // widened by the tolerance of its ends. A mismatch keeps every value but
  // marks all four.
  const calories = value('caloriesPer100g');
  if (
    calories !== undefined &&
    protein !== undefined &&
    carbs !== undefined &&
    fat !== undefined
  ) {
    const fiber = value('fiberPer100g') ?? 0;
    const lowest = 4 * protein + 4 * Math.max(0, carbs - fiber) + 9 * fat;
    const highest = 4 * protein + 4 * carbs + 9 * fat + 2 * fiber;
    const inRange =
      calories >= lowest - energyTolerance(lowest) &&
      calories <= highest + energyTolerance(highest);
    if (!inRange) {
      mark(
        ['caloriesPer100g', 'proteinPer100g', 'carbsPer100g', 'fatPer100g'],
        'Calories don’t match protein, carbs and fat — check these values.',
      );
    }
  }
  return checked;
}
