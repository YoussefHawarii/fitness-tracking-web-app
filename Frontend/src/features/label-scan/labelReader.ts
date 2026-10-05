import type { NutritionBasis } from '../../services/foodService';
import type { BBox, OcrLayout, OcrWord } from './ocrLayout';

// The Label reader: a pure function from a Label scan's word layout to
// Label readings (CONTEXT.md). It associates numbers with nutrients by
// where the words sit on the photo — rows by vertical position, segments
// by nutrient keyword — never by the raw order Tesseract emitted the text
// in. Anything it cannot place with certainty is left without a value
// rather than guessed; a missing value is never turned into zero.

export type LabelField =
  'caloriesPer100g' | 'proteinPer100g' | 'carbsPer100g' | 'fatPer100g';

export const LABEL_FIELDS: readonly LabelField[] = [
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'fatPer100g',
];

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
}

// ---------------------------------------------------------------------------
// Rows

interface Row {
  words: OcrWord[];
  y0: number;
  y1: number;
}

function verticalOverlapRatio(a: BBox, y0: number, y1: number): number {
  const overlap = Math.min(a.y1, y1) - Math.max(a.y0, y0);
  const smaller = Math.min(a.y1 - a.y0, y1 - y0);
  return smaller > 0 ? overlap / smaller : 0;
}

// Groups words into visual rows: a word joins the row it overlaps
// vertically by at least half of the shorter height. Words in a row are
// then ordered left to right by position.
function groupRows(words: readonly OcrWord[]): Row[] {
  const sorted = [...words].sort(
    (a, b) => a.bbox.y0 + a.bbox.y1 - (b.bbox.y0 + b.bbox.y1),
  );
  const rows: Row[] = [];
  for (const word of sorted) {
    let best: Row | undefined;
    let bestRatio = 0.5;
    for (const row of rows) {
      const ratio = verticalOverlapRatio(word.bbox, row.y0, row.y1);
      if (ratio >= bestRatio) {
        best = row;
        bestRatio = ratio;
      }
    }
    if (best) {
      best.words.push(word);
      best.y0 = Math.min(best.y0, word.bbox.y0);
      best.y1 = Math.max(best.y1, word.bbox.y1);
    } else {
      rows.push({ words: [word], y0: word.bbox.y0, y1: word.bbox.y1 });
    }
  }
  for (const row of rows) row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  return rows.sort((a, b) => a.y0 - b.y0);
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

// One separator: "." or "," as a decimal point ("2.5", "2,5"), except
// that a separator followed by exactly three digits ("1,046", "1.046") may
// be a thousands separator and is never read. Two or more separators are
// never read either.
export function parseLabelNumber(text: string): {
  value?: number;
  ambiguous: boolean;
} {
  const separators = text.match(/[.,]/g) ?? [];
  if (separators.length === 0) return { value: Number(text), ambiguous: false };
  if (separators.length > 1) return { ambiguous: true };
  const [whole, fraction] = text.split(/[.,]/);
  if (fraction.length === 3 && whole !== '0') return { ambiguous: true };
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
function tokenize(row: Row): Token[] {
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
  return ordered.flat();
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
  { tokens: ['sugar'] },
  { tokens: ['sugars'] },
  { tokens: ['of', 'which', 'sugars'] },
  { tokens: ['total', 'sugars'] },
  { tokens: ['added', 'sugars'] },
  { tokens: ['fibre'] },
  { tokens: ['fiber'] },
  { tokens: ['dietary', 'fiber'] },
  { tokens: ['dietary', 'fibre'] },
  { tokens: ['salt'] },
  { tokens: ['sodium'] },
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
  { tokens: ['سكر'] },
  { tokens: ['السكر'] },
  { tokens: ['سكريات'] },
  { tokens: ['السكريات'] },
  { tokens: ['منها', 'سكريات'] },
  { tokens: ['سكريات', 'مضافه'] },
  { tokens: ['الياف'] },
  { tokens: ['الالياف'] },
  { tokens: ['الياف', 'غذائيه'] },
  { tokens: ['الالياف', 'الغذائيه'] },
  { tokens: ['صوديوم'] },
  { tokens: ['الصوديوم'] },
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

const MASS_UNITS = new Set([
  'g',
  'gm',
  'gr',
  'grams',
  'gram',
  'جم',
  'جرام',
  'جرامات',
  'غ',
  'غم',
  'غرام',
  'غرامات',
]);
const MILLIGRAM_UNITS = new Set([
  'mg',
  'مجم',
  'ملجم',
  'ملغ',
  'مغ',
  'ملغم',
  'مليجرام',
  'ملليجرام',
]);
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

type Unit = 'g' | 'mg' | 'kcal' | 'kj';

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
    return undefined;
  }
  if (MASS_UNITS.has(token.text)) return { unit: 'g', length: 1 };
  if (MILLIGRAM_UNITS.has(token.text)) return { unit: 'mg', length: 1 };
  if (KCAL_UNITS.has(token.text)) return { unit: 'kcal', length: 1 };
  if (KJ_UNITS.has(token.text)) return { unit: 'kj', length: 1 };
  return undefined;
}

interface Candidate {
  value?: number;
  unit?: Unit;
  ambiguous: boolean;
  lessThan: boolean;
  // The word the number was printed in, for column placement.
  word: OcrWord;
}

interface Segment {
  keyword: Keyword;
  tokens: Token[];
  row: Row;
  arabic: boolean;
  // Its value could equally belong to a different nutrient named right
  // after it in Arabic (whose value, read right to left, sits to its left).
  contested?: boolean;
}

function candidatesIn(segment: Segment): Candidate[] {
  const { tokens } = segment;
  // A unit printed before any number ("Energy (kcal) 250") applies to the
  // segment's bare numbers.
  let defaultUnit: Unit | undefined;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].kind === 'number') break;
    defaultUnit ??= unitAt(tokens, i)?.unit;
  }

  const candidates: Candidate[] = [];
  tokens.forEach((token, i) => {
    if (token.kind !== 'number') return;
    const next = tokens[i + 1];
    if (next?.kind === 'percent') return;
    candidates.push({
      value: token.value,
      unit: unitAt(tokens, i + 1)?.unit ?? defaultUnit,
      ambiguous: token.ambiguous,
      lessThan: tokens[i - 1]?.kind === 'less-than',
      word: token.word,
    });
  });
  return candidates;
}

function segmentsOf(row: Row): Segment[] {
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
  return segments;
}

function unionBox(words: readonly OcrWord[]): BBox {
  return {
    x0: Math.min(...words.map((w) => w.bbox.x0)),
    y0: Math.min(...words.map((w) => w.bbox.y0)),
    x1: Math.max(...words.map((w) => w.bbox.x1)),
    y1: Math.max(...words.map((w) => w.bbox.y1)),
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

function readSegment(
  field: LabelField,
  segment: Segment,
  columns: ColumnModel,
): LabelReading {
  const evidence = evidenceOf(segment);
  const notFound = (warning?: string): LabelReading => ({
    field,
    status: 'not-found',
    warnings: warning ? [warning] : [],
    evidence,
  });

  const isEnergy = field === 'caloriesPer100g';
  // A value counts only with its unit printed next to it (or once before
  // the segment's numbers, "Energy (kcal) 250").
  const unitFits = (c: Candidate) =>
    isEnergy ? c.unit === 'kcal' : c.unit === 'g';

  // In a multi-column table only numbers placed in the target column
  // count; a number that straddles two columns can't be placed at all.
  const placed = candidatesIn(segment).map((c) => ({
    candidate: c,
    column: placeInColumn(c.word.bbox, columns),
  }));
  if (placed.some((p) => p.column === 'ambiguous' && unitFits(p.candidate))) {
    return notFound("Couldn't tell which column this value is in.");
  }
  const candidates = placed
    .filter((p) => p.column === columns.target)
    .map((p) => p.candidate);
  const usable = candidates.filter(unitFits);
  if (segment.contested && usable.length > 0) {
    return notFound("Couldn't tell which nutrient this value belongs to.");
  }

  if (usable.length === 0) {
    if (isEnergy && candidates.some((c) => c.unit === 'kj')) {
      return notFound('Only kJ is printed — calories were not read.');
    }
    return notFound();
  }
  if (usable.length > 1) {
    return notFound('Several values on this row — check the label.');
  }
  const [candidate] = usable;
  if (candidate.lessThan) {
    return notFound(
      'Printed as "less than" a value — enter it yourself if needed.',
    );
  }
  if (candidate.ambiguous || candidate.value === undefined) {
    return notFound("Couldn't read this number clearly.");
  }
  return {
    field,
    value: candidate.value,
    unit: candidate.unit,
    status: 'read',
    warnings: [],
    evidence,
  };
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
  'اليوميه',
  'المرجعيه',
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

function classifyPhrase(tokens: readonly Token[]): Column | undefined {
  // "Serving size 30 g" / "Net weight 100 g" state a quantity; they head
  // no column.
  if (tokens.some((t) => isWord(t, NOT_A_HEADING_WORDS))) return undefined;
  const words = tokens.map((t) => t.word);
  const x0 = Math.min(...words.map((w) => w.bbox.x0));
  const x1 = Math.max(...words.map((w) => w.bbox.x1));
  const extent = { x0, x1, center: (x0 + x1) / 2, script: scriptOf(tokens) };
  if (tokens.some((t) => t.kind === 'percent' || isWord(t, PERCENT_WORDS))) {
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
      (t) => t.kind === 'percent' || isWord(t, PERCENT_WORDS),
    );
    const justPer = current?.length === 1 && isWord(current[0], PER_WORDS);
    const starts =
      !current ||
      isWord(token, PER_WORDS) ||
      (isWord(token, SERVING_WORDS) && !justPer) ||
      (per100Basis(tokens, i) !== undefined && !justPer && !inServing) ||
      ((token.kind === 'percent' || isWord(token, PERCENT_WORDS)) &&
        !inPercent);
    if (starts || !current) phrases.push([token]);
    else current.push(token);
  });
  return phrases
    .map(classifyPhrase)
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
      (s) => s.keyword.field && s.tokens.some((t) => t.kind === 'number'),
    );
  const firstValueRow = rows.find(isValueRow);
  if (!firstValueRow) return undefined;

  const headingRows = rows
    .filter((row) => segmentsOf(row).length === 0)
    .map((row) => ({ row, phrases: headerPhrases(tokenize(row)) }))
    .filter((h) => h.phrases.length > 0);
  const inTable = headingRows.filter((h) => h.row.y0 >= firstValueRow.y0);
  if (inTable.some((h) => h.phrases.some((c) => c.kind !== 'percent'))) {
    return undefined;
  }
  const aboveTable = headingRows.filter((h) => h.row.y0 < firstValueRow.y0);

  // Headings stacked on several lines (or repeated in two languages) are
  // combined by position.
  // Each heading remembers which row it was printed on.
  let headings: HeadingColumn[] = aboveTable.flatMap((h, row) =>
    h.phrases.map((c) => ({ ...c, rows: new Set([row]) })),
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

const SINGLE_COLUMN: Column = { kind: 'per100', x0: 0, x1: 0, center: 0 };

export function readLabel(layout: OcrLayout): LabelScanResult {
  const rows = groupRows(layout.words);
  const model = columnModel(rows);
  // Without a usable header the values are still read as one column so
  // they can be shown for reference; the outcome keeps them out of the form.
  const columns: ColumnModel = model ?? {
    columns: [SINGLE_COLUMN],
    target: SINGLE_COLUMN,
  };

  const segmentsByField = new Map<LabelField, Segment[]>();
  for (const row of rows) {
    for (const segment of segmentsOf(row)) {
      const { field } = segment.keyword;
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
    const read = found.filter((f) => f.reading.status === 'read');
    if (read.length === 0) {
      return (found.find((f) => f.reading.warnings.length > 0) ?? found[0])
        .reading;
    }
    const values = [...new Set(read.map((f) => f.reading.value as number))];
    const languages = new Set(read.map((f) => f.segment.arabic));
    if (values.length > 1) {
      return {
        field,
        status: 'not-found',
        warnings: [
          languages.size > 1
            ? `The English and Arabic text disagree (${values.join(' / ')}) — check the label.`
            : 'The label shows different values for this — check it.',
        ],
        evidence: read[0].reading.evidence,
        conflictingValues: values,
      };
    }
    return languages.size > 1
      ? { ...read[0].reading, confirmedInBothLanguages: true }
      : read[0].reading;
  });

  if (!model) {
    return {
      outcome: 'no-per-100-column',
      readings,
      warnings: [
        "Couldn't find a single per 100 g or per 100 ml column — enter per-100 values manually.",
      ],
    };
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
  return {
    outcome: 'ok',
    basisSuggestion: model.target.basis,
    readings,
    warnings: [],
  };
}
