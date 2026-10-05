import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Label reader seam: word layout (text + position + confidence) in, Label
// readings out. Tesseract never runs here; fixtures place words where they
// would sit on a photographed label.

let vite;
let reader;
let layout;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [reader, layout] = await Promise.all([
    vite.ssrLoadModule('/src/features/label-scan/labelReader.ts'),
    vite.ssrLoadModule('/src/features/label-scan/ocrLayout.ts'),
  ]);
});

after(async () => {
  await vite.close();
});

const CHAR_WIDTH = 10;

// One visual row of words at height y; each item is [text, x].
function row(y, ...items) {
  return items.map(([text, x]) => ({
    text,
    bbox: { x0: x, y0: y, x1: x + text.length * CHAR_WIDTH, y1: y + 20 },
    confidence: 95,
  }));
}

function read(...rows) {
  return reader.readLabel({ words: rows.flat() });
}

function reading(result, field) {
  return result.readings.find((r) => r.field === field);
}

function values(result) {
  return Object.fromEntries(
    result.readings.map((r) => [r.field, r.status === 'read' ? r.value : null]),
  );
}

const PER_100_G_HEADER = row(
  40,
  ['Nutrition', 10],
  ['per', 120],
  ['100', 160],
  ['g', 200],
);

test('a clean single-column per 100 g label reads the four macros', () => {
  const result = read(
    PER_100_G_HEADER,
    row(
      80,
      ['Energy', 10],
      ['1046', 160],
      ['kJ', 210],
      ['/', 240],
      ['250', 260],
      ['kcal', 300],
    ),
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
    row(160, ['Carbohydrate', 10], ['40', 160], ['g', 190]),
    row(200, ['Fat', 10], ['12', 160], ['g', 190]),
  );

  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.deepEqual(values(result), {
    caloriesPer100g: 250,
    proteinPer100g: 21,
    carbsPer100g: 40,
    fatPer100g: 12,
  });
  assert.equal(reading(result, 'proteinPer100g').unit, 'g');
  assert.equal(reading(result, 'caloriesPer100g').unit, 'kcal');
  assert.equal(
    reading(result, 'proteinPer100g').evidence.rowText,
    'Protein 21 g',
  );
});

test('side-by-side nutrients on one line are never swapped, whatever the text order', () => {
  // Visually: "Protein 21 g    Carbohydrate 40 g". Tesseract emitted the
  // words in an order where naive text pairing would give protein = 40.
  const [protein, p21, pg, carbs, c40, cg] = row(
    120,
    ['Protein', 10],
    ['21', 90],
    ['g', 115],
    ['Carbohydrate', 200],
    ['40', 330],
    ['g', 355],
  );
  const result = reader.readLabel({
    words: [...PER_100_G_HEADER, carbs, protein, c40, cg, p21, pg],
  });

  assert.equal(reading(result, 'proteinPer100g').value, 21);
  assert.equal(reading(result, 'carbsPer100g').value, 40);
  assert.equal(reading(result, 'proteinPer100g').status, 'read');
  assert.equal(reading(result, 'carbsPer100g').status, 'read');
});

test('names and values split into separate blocks are rejoined by row position', () => {
  const names = [
    ...row(120, ['Protein', 10]),
    ...row(160, ['Carbohydrate', 10]),
    ...row(200, ['Fat', 10]),
  ];
  const valueColumn = [
    ...row(201, ['12', 300], ['g', 330]),
    ...row(119, ['21', 300], ['g', 330]),
    ...row(161, ['40', 300], ['g', 330]),
  ];
  const result = reader.readLabel({
    words: [...valueColumn, ...names, ...PER_100_G_HEADER],
  });

  assert.equal(reading(result, 'proteinPer100g').value, 21);
  assert.equal(reading(result, 'carbsPer100g').value, 40);
  assert.equal(reading(result, 'fatPer100g').value, 12);
});

test('words fused by OCR ("Protein21g") still read', () => {
  const result = read(PER_100_G_HEADER, row(120, ['Protein21g', 10]));
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('a unit printed before the number applies to it ("Energy (kcal) 250")', () => {
  const result = read(
    PER_100_G_HEADER,
    row(80, ['Energy', 10], ['(kcal)', 90], ['250', 200]),
  );
  assert.equal(reading(result, 'caloriesPer100g').value, 250);
});

test('saturated fat never fills total fat', () => {
  const both = read(
    PER_100_G_HEADER,
    row(200, ['Fat', 10], ['12', 160], ['g', 190]),
    row(240, ['Saturated', 10], ['fat', 110], ['3', 160], ['g', 190]),
  );
  assert.equal(reading(both, 'fatPer100g').value, 12);

  const onlySaturated = read(
    PER_100_G_HEADER,
    row(240, ['Saturated', 10], ['fat', 110], ['3', 160], ['g', 190]),
  );
  assert.equal(reading(onlySaturated, 'fatPer100g').status, 'not-found');
  assert.equal(reading(onlySaturated, 'fatPer100g').value, undefined);
});

test('a kJ-only energy row is never read as calories', () => {
  const result = read(
    PER_100_G_HEADER,
    row(80, ['Energy', 10], ['1046', 160], ['kJ', 210]),
  );
  const calories = reading(result, 'caloriesPer100g');
  assert.equal(calories.status, 'not-found');
  assert.equal(calories.value, undefined);
  assert.match(calories.warnings[0], /kJ/);
});

test('"less than" values and unclear numbers stay empty, never 0', () => {
  const result = read(
    PER_100_G_HEADER,
    row(120, ['Protein', 10], ['<0.5', 160], ['g', 210]),
    row(160, ['Fat', 10], ['1,5', 160], ['g', 200]),
  );
  for (const field of ['proteinPer100g', 'fatPer100g']) {
    const r = reading(result, field);
    assert.equal(r.status, 'not-found');
    assert.equal(r.value, undefined);
    assert.equal(r.warnings.length, 1);
  }
});

test('a row with several gram values is left unresolved rather than guessed', () => {
  const result = read(
    PER_100_G_HEADER,
    row(
      120,
      ['Protein', 10],
      ['6.3', 160],
      ['g', 200],
      ['21', 260],
      ['g', 290],
    ),
  );
  assert.equal(reading(result, 'proteinPer100g').status, 'not-found');
  assert.equal(reading(result, 'proteinPer100g').value, undefined);
});

test('conflicting rows for the same nutrient leave it empty', () => {
  const result = read(
    PER_100_G_HEADER,
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
    row(300, ['Protein', 10], ['12', 160], ['g', 190]),
  );
  assert.equal(reading(result, 'proteinPer100g').status, 'not-found');
});

test('only an explicit per-100 phrase declares the basis', () => {
  const noHeader = read(
    row(40, ['Serving', 10], ['size', 100], ['100', 160], ['g', 200]),
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
  );
  assert.equal(noHeader.outcome, 'no-per-100-column');
  assert.equal(noHeader.basisSuggestion, undefined);
  assert.equal(noHeader.warnings.length, 1);
  // The value is still shown for reference, but the outcome stops it
  // from filling a per-100 field.
  assert.equal(reading(noHeader, 'proteinPer100g').value, 21);

  const slash = read(
    row(40, ['Values', 10], ['/100ml', 100]),
    row(120, ['Protein', 10], ['1.2', 160], ['g', 200]),
  );
  assert.equal(slash.outcome, 'ok');
  assert.equal(slash.basisSuggestion, 'PER_100_ML');
});

test('Tesseract blocks flatten to words, dropping empty ones', () => {
  const bbox = { x0: 1, y0: 2, x1: 3, y1: 4 };
  const flat = layout.layoutFromBlocks([
    {
      paragraphs: [
        {
          lines: [
            {
              words: [
                { text: ' Protein ', bbox, confidence: 91 },
                { text: '  ', bbox, confidence: 10 },
              ],
            },
          ],
        },
      ],
    },
  ]);
  assert.deepEqual(flat, {
    words: [{ text: 'Protein', bbox, confidence: 91 }],
  });
  assert.deepEqual(layout.layoutFromBlocks(null), { words: [] });
});
