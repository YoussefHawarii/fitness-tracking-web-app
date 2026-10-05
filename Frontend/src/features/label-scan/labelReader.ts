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
}

// 'ok' — readings came from a column the label headed per 100 g / 100 ml.
// 'no-per-100-column' — no such header was read, so no reading may fill a
// per-100 field (ADR 0009); readings are reference only.
export type LabelScanOutcome = 'ok' | 'no-per-100-column';

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
  | { kind: 'word'; text: string; word: OcrWord }
  | {
      kind: 'number';
      text: string;
      value?: number;
      // A comma inside a number ("1,046" or "2,5") is ambiguous between a
      // thousands separator and a decimal comma, so it is never read.
      ambiguous: boolean;
      word: OcrWord;
    }
  | { kind: 'less-than'; text: string; word: OcrWord }
  | { kind: 'percent'; text: string; word: OcrWord };

const TOKEN_PATTERN = /\d+(?:[.,]\d+)*|[a-z]+|<|%/g;

function tokenize(row: Row): Token[] {
  const tokens: Token[] = [];
  for (const word of row.words) {
    for (const match of word.text.toLowerCase().matchAll(TOKEN_PATTERN)) {
      const text = match[0];
      if (/^\d/.test(text)) {
        const ambiguous = text.includes(',');
        tokens.push({
          kind: 'number',
          text,
          ambiguous,
          ...(!ambiguous && { value: Number(text) }),
          word,
        });
      } else if (text === '<') {
        tokens.push({ kind: 'less-than', text, word });
      } else if (text === '%') {
        tokens.push({ kind: 'percent', text, word });
      } else {
        tokens.push({ kind: 'word', text, word });
      }
    }
  }
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
  // Whether a bare number (no unit) may be read as kcal for this keyword.
  bareNumberIsKcal?: boolean;
}

const KEYWORDS: readonly Keyword[] = [
  { tokens: ['energy'], field: 'caloriesPer100g' },
  { tokens: ['energy', 'value'], field: 'caloriesPer100g' },
  { tokens: ['total', 'energy'], field: 'caloriesPer100g' },
  { tokens: ['calories'], field: 'caloriesPer100g', bareNumberIsKcal: true },
  { tokens: ['calorie'], field: 'caloriesPer100g', bareNumberIsKcal: true },
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
];

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

const MASS_UNITS = new Set(['g', 'gm', 'gr', 'grams', 'gram']);
const MILLIGRAM_UNITS = new Set(['mg']);
const KCAL_UNITS = new Set(['kcal']);
const KJ_UNITS = new Set(['kj']);

type Unit = 'g' | 'mg' | 'kcal' | 'kj';

function unitOf(token: Token | undefined): Unit | undefined {
  if (token?.kind !== 'word') return undefined;
  if (MASS_UNITS.has(token.text)) return 'g';
  if (MILLIGRAM_UNITS.has(token.text)) return 'mg';
  if (KCAL_UNITS.has(token.text)) return 'kcal';
  if (KJ_UNITS.has(token.text)) return 'kj';
  return undefined;
}

interface Candidate {
  value?: number;
  unit?: Unit;
  ambiguous: boolean;
  lessThan: boolean;
}

interface Segment {
  keyword: Keyword;
  tokens: Token[];
  row: Row;
}

function candidatesIn(segment: Segment): Candidate[] {
  const { tokens } = segment;
  // A unit printed before any number ("Energy (kcal) 250") applies to the
  // segment's bare numbers.
  let defaultUnit: Unit | undefined;
  for (const token of tokens) {
    if (token.kind === 'number') break;
    defaultUnit ??= unitOf(token);
  }

  const candidates: Candidate[] = [];
  tokens.forEach((token, i) => {
    if (token.kind !== 'number') return;
    const next = tokens[i + 1];
    if (next?.kind === 'percent') return;
    candidates.push({
      value: token.value,
      unit: unitOf(next) ?? defaultUnit,
      ambiguous: token.ambiguous,
      lessThan: tokens[i - 1]?.kind === 'less-than',
    });
  });
  return candidates;
}

function segmentsOf(row: Row): Segment[] {
  const tokens = tokenize(row);
  const segments: Segment[] = [];
  let i = 0;
  while (i < tokens.length) {
    const match = keywordAt(tokens, i);
    if (match) {
      segments.push({ keyword: match.keyword, tokens: [], row });
      i += match.length;
      continue;
    }
    segments.at(-1)?.tokens.push(tokens[i]);
    i += 1;
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
  return {
    rowText: segment.row.words.map((w) => w.text).join(' '),
    bbox: unionBox(words.length ? words : segment.row.words),
  };
}

function readSegment(field: LabelField, segment: Segment): LabelReading {
  const candidates = candidatesIn(segment);
  const evidence = evidenceOf(segment);
  const notFound = (warning?: string): LabelReading => ({
    field,
    status: 'not-found',
    warnings: warning ? [warning] : [],
    evidence,
  });

  const isEnergy = field === 'caloriesPer100g';
  const usable = candidates.filter((c) =>
    isEnergy
      ? c.unit === 'kcal' ||
        (c.unit === undefined && segment.keyword.bareNumberIsKcal)
      : c.unit === 'g',
  );

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
    unit: candidate.unit ?? 'kcal',
    status: 'read',
    warnings: [],
    evidence,
  };
}

// ---------------------------------------------------------------------------
// Basis header

const BASIS_UNITS: Record<string, NutritionBasis> = {
  g: 'PER_100_G',
  gm: 'PER_100_G',
  gr: 'PER_100_G',
  grams: 'PER_100_G',
  ml: 'PER_100_ML',
};

// A basis is declared only by an explicit "per 100 g" / "/100 ml" phrase.
// A bare "100 g" elsewhere ("Serving size 100 g") states nothing about the
// denominator, so it never counts.
function headerBases(rows: readonly Row[]): Set<NutritionBasis> {
  const bases = new Set<NutritionBasis>();
  for (const row of rows) {
    const tokens = tokenize(row);
    const rowText = row.words.map((w) => w.text).join(' ');
    tokens.forEach((token, i) => {
      const previous = tokens[i - 1];
      const perPrefix =
        (previous?.kind === 'word' && previous.text === 'per') ||
        new RegExp(`/\\s*${token.text}(?!\\d)`).test(rowText);
      if (token.kind !== 'number' || token.value !== 100 || !perPrefix) return;
      const next = tokens[i + 1];
      const basis = next?.kind === 'word' ? BASIS_UNITS[next.text] : undefined;
      if (basis) bases.add(basis);
    });
  }
  return bases;
}

// ---------------------------------------------------------------------------

export function readLabel(layout: OcrLayout): LabelScanResult {
  const rows = groupRows(layout.words);
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
    const found = segments.map((s) => readSegment(field, s));
    const read = found.filter((r) => r.status === 'read');
    if (read.length === 0) return found[0];
    const values = new Set(read.map((r) => r.value));
    if (values.size > 1) {
      return {
        field,
        status: 'not-found',
        warnings: ['The label shows different values for this — check it.'],
        evidence: read[0].evidence,
      };
    }
    return read[0];
  });

  const bases = headerBases(rows);
  if (bases.size !== 1) {
    return {
      outcome: 'no-per-100-column',
      readings,
      warnings: [
        bases.size === 0
          ? "Couldn't find a per 100 g or per 100 ml column — enter per-100 values manually."
          : 'The label mentions both per 100 g and per 100 ml — enter per-100 values manually.',
      ],
    };
  }
  const [basisSuggestion] = bases;
  return { outcome: 'ok', basisSuggestion, readings, warnings: [] };
}
