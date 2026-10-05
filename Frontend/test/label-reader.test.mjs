import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Label reader seam: word layout (text + position + confidence) in, Label
// readings out. Tesseract never runs here; fixtures place words where they
// would sit on a photographed label. Fixture words carry no numberCheck, so
// they stand for numbers the engine has already verified — these tests
// prove the reader's logic. What a live scan can verify (Arabic-Indic
// digits never are, ADR 0010) is covered in recognition-passes.test.mjs.

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

const MACROS = [
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'fatPer100g',
];

// The four required macros as read (null when not read).
function values(result) {
  return Object.fromEntries(
    result.readings
      .filter((r) => MACROS.includes(r.field))
      .map((r) => [r.field, r.status === 'read' ? r.value : null]),
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

test('a kJ-only energy row is converted to kcal and marked converted', () => {
  const result = read(
    PER_100_G_HEADER,
    row(80, ['Energy', 10], ['1046', 160], ['kJ', 210]),
  );
  const calories = reading(result, 'caloriesPer100g');
  assert.equal(calories.status, 'read');
  assert.equal(calories.value, 250);
  assert.equal(calories.unit, 'kcal');
  assert.equal(calories.conversion, 'from-kj');
});

test('"less than" values and unclear numbers stay empty, never 0', () => {
  const result = read(
    PER_100_G_HEADER,
    row(120, ['Protein', 10], ['<0.5', 160], ['g', 210]),
    row(160, ['Fat', 10], ['1,046', 160], ['g', 200]),
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

test('mono-, poly- and unsaturated fat rows never fill total fat', () => {
  for (const words of [
    [
      ['Monounsaturated', 10],
      ['fat', 180],
    ],
    [
      ['Polyunsaturated', 10],
      ['fat', 180],
    ],
    [
      ['Unsaturated', 10],
      ['fat', 140],
    ],
    [
      ['Trans', 10],
      ['fat', 80],
    ],
  ]) {
    const result = read(
      PER_100_G_HEADER,
      row(240, ...words, ['5', 260], ['g', 290]),
    );
    const fat = reading(result, 'fatPer100g');
    assert.equal(fat.status, 'not-found', words[0][0]);
    assert.equal(fat.value, undefined, words[0][0]);
  }
});

// --- Columns (#32) -----------------------------------------------------

// "per serving (30 g) | per 100 g | %RI" with columns centred near
// x = 220, 440 and 580.
const THREE_COLUMN_HEADER = row(
  40,
  ['per', 160],
  ['serving', 195],
  ['(30', 270],
  ['g)', 305],
  ['per', 400],
  ['100', 435],
  ['g', 470],
  ['%RI', 565],
);

test('a per serving | per 100 g | %RI table reads only the per-100 g column', () => {
  const result = read(
    THREE_COLUMN_HEADER,
    row(
      80,
      ['Energy', 10],
      ['75', 200],
      ['kcal', 230],
      ['250', 420],
      ['kcal', 455],
      ['13%', 570],
    ),
    row(
      120,
      ['Protein', 10],
      ['6.3', 200],
      ['g', 235],
      ['21', 420],
      ['g', 445],
      ['42%', 570],
    ),
    row(
      160,
      ['Carbohydrate', 10],
      ['12', 200],
      ['g', 225],
      ['40', 420],
      ['g', 445],
      ['15%', 570],
    ),
    row(
      200,
      ['Fat', 10],
      ['3.6', 200],
      ['g', 235],
      ['12', 420],
      ['g', 445],
      ['17%', 570],
    ),
    row(
      230,
      ['Saturated', 30],
      ['fat', 130],
      ['0.9', 200],
      ['g', 235],
      ['3', 420],
      ['g', 435],
      ['15%', 570],
    ),
    row(
      260,
      ['of', 30],
      ['which', 60],
      ['sugars', 120],
      ['2.4', 200],
      ['g', 235],
      ['8', 420],
      ['g', 435],
      ['9%', 570],
    ),
  );

  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.deepEqual(values(result), {
    caloriesPer100g: 250,
    proteinPer100g: 21,
    carbsPer100g: 40,
    fatPer100g: 12,
  });
});

test('a per 100 ml column on the left of a serving column is used, not the serving one', () => {
  const result = read(
    row(
      40,
      ['Per', 160],
      ['100', 195],
      ['ml', 230],
      ['Per', 380],
      ['serving', 415],
      ['(250', 490],
      ['ml)', 545],
    ),
    row(
      80,
      ['Energy', 10],
      ['42', 180],
      ['kcal', 205],
      ['105', 420],
      ['kcal', 455],
    ),
    row(
      120,
      ['Carbohydrate', 10],
      ['10.6', 180],
      ['g', 225],
      ['26.5', 420],
      ['g', 465],
    ),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_ML');
  assert.equal(reading(result, 'caloriesPer100g').value, 42);
  assert.equal(reading(result, 'carbsPer100g').value, 10.6);
});

test('a bare "100g" heading next to a serving heading counts as the per-100 column', () => {
  const result = read(
    row(40, ['Nutrition', 10], ['100g', 200], ['Serving', 380]),
    row(
      120,
      ['Protein', 10],
      ['21', 200],
      ['g', 225],
      ['6.3', 380],
      ['g', 415],
    ),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('a per-serving-only label is reported as such, with no basis and reference values only', () => {
  const result = read(
    row(
      40,
      ['Amount', 10],
      ['per', 160],
      ['serving', 195],
      ['(30', 270],
      ['g)', 305],
      ['%DV', 450],
    ),
    row(120, ['Protein', 10], ['6.3', 200], ['g', 235], ['12%', 450]),
    row(160, ['Fat', 10], ['3.6', 200], ['g', 235], ['5%', 450]),
  );

  assert.equal(result.outcome, 'per-serving-only');
  assert.equal(result.basisSuggestion, undefined);
  assert.match(result.warnings[0], /per-serving values only/);
  // Shown for reference — the outcome keeps them out of the form.
  assert.equal(reading(result, 'proteinPer100g').value, 6.3);
});

test('"Serving size 30 g" describes the serving and heads no column', () => {
  const result = read(
    PER_100_G_HEADER,
    row(70, ['Serving', 10], ['size', 100], ['30', 160], ['g', 190]),
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(reading(result, 'proteinPer100g').value, 21);

  const servingSizeOnly = read(
    row(70, ['Serving', 10], ['size', 100], ['100', 160], ['g', 200]),
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
  );
  assert.equal(servingSizeOnly.outcome, 'no-per-100-column');
});

test('a number straddling two columns is left unresolved', () => {
  // The "21" word spans x = 290..380, across the serving / per-100
  // boundary at ~341.
  const result = reader.readLabel({
    words: [
      ...THREE_COLUMN_HEADER,
      ...row(120, ['Protein', 10]),
      {
        text: '21',
        bbox: { x0: 290, y0: 120, x1: 380, y1: 140 },
        confidence: 95,
      },
      ...row(120, ['g', 390]),
    ],
  });
  const protein = reading(result, 'proteinPer100g');
  assert.equal(protein.status, 'not-found');
  assert.equal(protein.value, undefined);
  assert.match(protein.warnings[0], /column/);
});

test('a value with no unit next to it is not filled', () => {
  const result = read(
    PER_100_G_HEADER,
    row(120, ['Protein', 10], ['21', 160]),
    row(160, ['Fat', 10], ['12', 160], ['g', 190]),
  );
  assert.equal(reading(result, 'proteinPer100g').status, 'not-found');
  assert.equal(reading(result, 'proteinPer100g').value, undefined);
  assert.equal(reading(result, 'fatPer100g').value, 12);
});

test('per 100 g and per 100 ml headings together declare no basis', () => {
  const result = read(
    row(
      40,
      ['per', 160],
      ['100', 195],
      ['g', 230],
      ['per', 380],
      ['100', 415],
      ['ml', 450],
    ),
    row(120, ['Protein', 10], ['21', 200], ['g', 225], ['21', 420], ['g', 445]),
  );
  assert.equal(result.outcome, 'no-per-100-column');
  assert.equal(result.basisSuggestion, undefined);
});

test('a pack-size footer never becomes a per-100 heading', () => {
  const result = read(
    row(40, ['Amount', 10], ['per', 160], ['serving', 195]),
    row(120, ['Protein', 10], ['6.3', 200], ['g', 235]),
    row(300, ['Net', 10], ['weight', 60], ['100', 160], ['g', 200]),
  );
  assert.equal(result.outcome, 'per-serving-only');
  assert.equal(result.basisSuggestion, undefined);
});

test('a heading inside or below the table leaves the layout unresolved', () => {
  // A second table with its own basis further down the label.
  const twoTables = read(
    PER_100_G_HEADER,
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
    row(260, ['Drink', 10], ['per', 120], ['100', 160], ['ml', 200]),
    row(300, ['Protein', 10], ['1.2', 160], ['g', 200]),
  );
  assert.equal(twoTables.outcome, 'no-per-100-column');
  assert.equal(twoTables.basisSuggestion, undefined);

  // A per-100 phrase that only appears below the values.
  const footer = read(
    row(40, ['Amount', 10], ['per', 160], ['serving', 195]),
    row(120, ['Protein', 10], ['6.3', 200], ['g', 235]),
    row(300, ['Values', 10], ['per', 120], ['100', 160], ['g', 200]),
  );
  assert.equal(footer.outcome, 'no-per-100-column');
});

test('headings stacked on two lines combine by position', () => {
  const result = read(
    row(30, ['Per', 180], ['serving', 215]),
    row(55, ['Per', 400], ['100', 435], ['g', 470]),
    row(
      120,
      ['Protein', 10],
      ['6.3', 200],
      ['g', 235],
      ['21', 420],
      ['g', 445],
    ),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.equal(reading(result, 'proteinPer100g').value, 21);

  // Different headings stacked over the same column can't be told apart.
  const overlapping = read(
    row(30, ['Per', 400], ['serving', 435]),
    row(55, ['Per', 400], ['100', 435], ['g', 470]),
    row(120, ['Protein', 10], ['21', 420], ['g', 445]),
  );
  assert.equal(overlapping.outcome, 'no-per-100-column');
});

test('calories without a printed unit are not read', () => {
  const bare = read(PER_100_G_HEADER, row(80, ['Calories', 10], ['250', 160]));
  assert.equal(reading(bare, 'caloriesPer100g').status, 'not-found');
  assert.equal(reading(bare, 'caloriesPer100g').value, undefined);

  const withUnit = read(
    PER_100_G_HEADER,
    row(80, ['Calories', 10], ['250', 160], ['kcal', 200]),
  );
  assert.equal(reading(withUnit, 'caloriesPer100g').value, 250);
});

test('two separate per 100 g columns ("as sold" and "prepared") stay unresolved', () => {
  const result = read(
    row(30, ['As', 170], ['sold', 200], ['Prepared', 390]),
    row(
      55,
      ['Per', 160],
      ['100', 195],
      ['g', 230],
      ['Per', 380],
      ['100', 415],
      ['g', 450],
    ),
    row(120, ['Protein', 10], ['21', 180], ['g', 205]),
  );
  assert.equal(result.outcome, 'no-per-100-column');
  assert.equal(result.basisSuggestion, undefined);
});

test('a product name above the title does not hide the per-100 title', () => {
  const result = read(
    row(10, ['PROTEIN', 10], ['BAR', 100]),
    row(
      40,
      ['Nutrition', 10],
      ['information', 110],
      ['per', 230],
      ['100', 270],
      ['g', 310],
    ),
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('a serving-size phrase beside a per-100 heading keeps the heading', () => {
  const result = read(
    row(
      40,
      ['Serving', 10],
      ['size', 90],
      ['30', 140],
      ['g', 165],
      ['Per', 380],
      ['100', 415],
      ['g', 450],
    ),
    row(120, ['Protein', 10], ['21', 410], ['g', 435]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('a %RI footnote below the table does not unresolve it', () => {
  const result = read(
    THREE_COLUMN_HEADER,
    row(
      120,
      ['Protein', 10],
      ['6.3', 200],
      ['g', 235],
      ['21', 420],
      ['g', 445],
      ['42%', 570],
    ),
    row(
      300,
      ['*%RI:', 10],
      ['Reference', 70],
      ['intake', 170],
      ['of', 240],
      ['an', 270],
      ['average', 300],
      ['adult', 380],
    ),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('close side-by-side per 100 g headings never merge, even with a value missing', () => {
  const result = read(
    row(
      55,
      ['Per', 160],
      ['100', 195],
      ['g', 230],
      ['Per', 250],
      ['100', 285],
      ['g', 320],
    ),
    // Only the second column's value was read.
    row(120, ['Protein', 10], ['18', 280], ['g', 305]),
  );
  assert.equal(result.outcome, 'no-per-100-column');
  assert.equal(result.basisSuggestion, undefined);
});

test('the same heading stacked in two lines over one column is one column', () => {
  const result = read(
    row(30, ['Per', 400], ['100', 435], ['g', 470]),
    row(55, ['per', 405], ['100', 440], ['grams', 475]),
    row(120, ['Protein', 10], ['21', 420], ['g', 445]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

// --- Arabic and bilingual (#33) -------------------------------------------
// Arabic is laid out right to left, so in these fixtures an Arabic row's
// first word (in reading order) has the largest x.

test('Arabic digits, the Arabic decimal separator and decimal commas parse', () => {
  assert.equal(reader.normalizeLabelText('١٢٫٥'), '12.5');
  assert.equal(reader.normalizeLabelText('۲۱'), '21');
  assert.equal(reader.normalizeLabelText('٤٢٪'), '42%');
  assert.equal(reader.normalizeLabelText('الدهون المشبعة'), 'الدهون المشبعه');
  assert.deepEqual(reader.parseLabelNumber('2,5'), {
    value: 2.5,
    ambiguous: false,
  });
  assert.deepEqual(reader.parseLabelNumber('12.5'), {
    value: 12.5,
    ambiguous: false,
  });
  assert.deepEqual(reader.parseLabelNumber('0,125'), {
    value: 0.125,
    ambiguous: false,
  });
  assert.deepEqual(reader.parseLabelNumber('1,046'), { ambiguous: true });
  assert.deepEqual(reader.parseLabelNumber('1.046'), { ambiguous: true });
  assert.deepEqual(reader.parseLabelNumber('1,046.5'), { ambiguous: true });
});

test('an Arabic-only per 100 g label reads every macro', () => {
  const result = read(
    row(40, ['لكل', 300], ['١٠٠', 240], ['جم', 200]),
    row(80, ['طاقة', 300], ['٢٥٠', 220], ['سعر', 170], ['حراري', 110]),
    row(120, ['بروتين', 300], ['٢١', 200], ['جم', 160]),
    row(160, ['كربوهيدرات', 300], ['٤٠', 200], ['جم', 160]),
    row(200, ['دهون', 300], ['١٢٫٥', 190], ['جم', 140]),
    row(240, ['دهون', 330], ['مشبعة', 270], ['٣', 200], ['جم', 160]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.deepEqual(values(result), {
    caloriesPer100g: 250,
    proteinPer100g: 21,
    carbsPer100g: 40,
    fatPer100g: 12.5,
  });
  assert.equal(
    reading(result, 'proteinPer100g').evidence.rowText,
    'بروتين ٢١ جم',
  );
});

test('a decimal comma reads as a decimal, never as thousands', () => {
  const result = read(
    PER_100_G_HEADER,
    row(160, ['Fat', 10], ['2,5', 160], ['g', 200]),
  );
  assert.equal(reading(result, 'fatPer100g').value, 2.5);
});

test('Arabic per-100 headings choose the column like English ones', () => {
  // Right to left: name | لكل ١٠٠ جم | لكل حصة (٣٠ جم) | ٪
  const result = read(
    row(
      40,
      ['لكل', 440],
      ['١٠٠', 400],
      ['جم', 370],
      ['لكل', 250],
      ['حصة', 210],
      ['(٣٠', 170],
      ['جم)', 140],
      ['٪', 50],
    ),
    row(
      120,
      ['بروتين', 540],
      ['٢١', 400],
      ['جم', 370],
      ['٦٫٣', 200],
      ['جم', 160],
      ['٤٢٪', 40],
    ),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.equal(reading(result, 'proteinPer100g').value, 21);

  const perMl = read(
    row(40, ['لكل', 300], ['١٠٠', 240], ['مل', 200]),
    row(120, ['كربوهيدرات', 330], ['١٠٫٦', 200], ['جم', 150]),
  );
  assert.equal(perMl.basisSuggestion, 'PER_100_ML');
  assert.equal(reading(perMl, 'carbsPer100g').value, 10.6);
});

test('two nutrients on one Arabic line keep their own values', () => {
  // Reads: دهون ١٢ جم   بروتين ٢١ جم
  const result = read(
    row(40, ['لكل', 600], ['١٠٠', 540], ['جم', 500]),
    row(
      120,
      ['دهون', 500],
      ['١٢', 440],
      ['جم', 400],
      ['بروتين', 300],
      ['٢١', 240],
      ['جم', 200],
    ),
  );
  assert.equal(reading(result, 'fatPer100g').value, 12);
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('values read the same in English and Arabic are confirmed by both', () => {
  const stacked = read(
    PER_100_G_HEADER,
    row(200, ['Fat', 10], ['12', 160], ['g', 190]),
    row(230, ['دهون', 300], ['١٢', 200], ['جم', 160]),
  );
  const fat = reading(stacked, 'fatPer100g');
  assert.equal(fat.value, 12);
  assert.equal(fat.status, 'read');
  assert.equal(fat.confirmedInBothLanguages, true);

  // Same row: English name, value, Arabic name.
  const sameRow = read(
    PER_100_G_HEADER,
    row(200, ['Fat', 10], ['12', 160], ['g', 190], ['دهون', 300]),
  );
  assert.equal(reading(sameRow, 'fatPer100g').value, 12);
});

test('English and Arabic readings that disagree leave the field empty with both shown', () => {
  const result = read(
    PER_100_G_HEADER,
    row(200, ['Fat', 10], ['12', 160], ['g', 190]),
    row(230, ['دهون', 300], ['١٫٢', 200], ['جم', 160]),
  );
  const fat = reading(result, 'fatPer100g');
  assert.equal(fat.status, 'not-found');
  assert.equal(fat.value, undefined);
  assert.deepEqual(fat.conflictingValues, [12, 1.2]);
  assert.match(fat.warnings[0], /English and Arabic/);
});

test('mixed-direction rows (Arabic name, Western digits) read correctly', () => {
  const latinUnit = read(
    PER_100_G_HEADER,
    row(120, ['21', 200], ['g', 225], ['بروتين', 300]),
  );
  assert.equal(reading(latinUnit, 'proteinPer100g').value, 21);

  const arabicUnit = read(
    PER_100_G_HEADER,
    row(120, ['بروتين', 300], ['21', 220], ['جم', 180]),
  );
  assert.equal(reading(arabicUnit, 'proteinPer100g').value, 21);
});

test('an English value followed by a different Arabic nutrient is never guessed', () => {
  const result = read(
    PER_100_G_HEADER,
    row(120, ['Fat', 10], ['12', 160], ['g', 190], ['بروتين', 300]),
  );
  assert.equal(reading(result, 'fatPer100g').status, 'not-found');
  assert.equal(reading(result, 'fatPer100g').value, undefined);
  assert.equal(reading(result, 'proteinPer100g').value, undefined);
});

test('Arabic calorie units, including two-word kcal, read as kcal', () => {
  const twoWord = read(
    PER_100_G_HEADER,
    row(
      80,
      ['السعرات', 500],
      ['الحرارية', 400],
      ['٢٥٠', 320],
      ['كيلو', 260],
      ['كالوري', 180],
    ),
  );
  assert.equal(reading(twoWord, 'caloriesPer100g').value, 250);

  const sueraat = read(
    PER_100_G_HEADER,
    row(80, ['الطاقة', 400], ['٢٥٠', 320], ['سعرات', 250], ['حرارية', 180]),
  );
  assert.equal(reading(sueraat, 'caloriesPer100g').value, 250);
});

test('an English and an Arabic per-100 heading side by side are one column', () => {
  const result = read(
    row(40, ['Per', 160], ['100g', 195], ['١٠٠جم', 270], ['لكل', 330]),
    row(120, ['Protein', 10], ['21', 240], ['g', 265]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('English and Arabic per-100 headings far apart on one row stay separate', () => {
  // They may head an "as sold" and a "prepared" column.
  const result = read(
    row(
      40,
      ['Per', 160],
      ['100', 195],
      ['g', 230],
      ['١٠٠', 640],
      ['جم', 600],
      ['لكل', 690],
    ),
    row(120, ['Protein', 10], ['21', 200], ['g', 225]),
  );
  assert.equal(result.outcome, 'no-per-100-column');
  assert.equal(result.basisSuggestion, undefined);
});

// --- More fields and units (#34) -----------------------------------------

test('kcal is preferred over kJ and a kJ number is never used as kcal', () => {
  const both = read(
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
  );
  const calories = reading(both, 'caloriesPer100g');
  assert.equal(calories.value, 250);
  assert.equal(calories.conversion, undefined);
});

test('sodium reads in mg whether printed in mg or g', () => {
  const mg = read(
    PER_100_G_HEADER,
    row(300, ['Sodium', 10], ['400', 160], ['mg', 210]),
  );
  assert.equal(reading(mg, 'sodiumMgPer100').value, 400);
  assert.equal(reading(mg, 'sodiumMgPer100').unit, 'mg');
  assert.equal(reading(mg, 'sodiumMgPer100').conversion, undefined);

  const g = read(
    PER_100_G_HEADER,
    row(300, ['Sodium', 10], ['0.4', 160], ['g', 200]),
  );
  assert.equal(reading(g, 'sodiumMgPer100').value, 400);
  assert.equal(reading(g, 'sodiumMgPer100').unit, 'mg');
  assert.equal(reading(g, 'sodiumMgPer100').conversion, 'from-g');
});

test('salt is never turned into sodium', () => {
  const result = read(
    PER_100_G_HEADER,
    row(300, ['Salt', 10], ['1', 160], ['g', 190]),
  );
  const sodium = reading(result, 'sodiumMgPer100');
  assert.equal(sodium.status, 'not-found');
  assert.equal(sodium.value, undefined);
  assert.match(sodium.warnings[0], /salt/i);

  // With a sodium row as well, sodium comes from its own row only.
  const both = read(
    PER_100_G_HEADER,
    row(300, ['Salt', 10], ['1', 160], ['g', 190]),
    row(330, ['Sodium', 10], ['0.4', 160], ['g', 200]),
  );
  assert.equal(reading(both, 'sodiumMgPer100').value, 400);
  assert.deepEqual(reading(both, 'sodiumMgPer100').warnings, []);
});

test('fiber and sugars fill from their own rows only', () => {
  const result = read(
    PER_100_G_HEADER,
    row(160, ['Carbohydrate', 10], ['40', 160], ['g', 190]),
    row(
      190,
      ['of', 30],
      ['which', 60],
      ['sugars', 120],
      ['8', 200],
      ['g', 220],
    ),
    row(220, ['added', 30], ['sugars', 100], ['5', 200], ['g', 220]),
    row(250, ['Fibre', 10], ['3.5', 160], ['g', 200]),
  );
  assert.equal(reading(result, 'carbsPer100g').value, 40);
  assert.equal(reading(result, 'sugarPer100g').value, 8);
  assert.equal(reading(result, 'fiberPer100g').value, 3.5);

  const arabic = read(
    row(40, ['لكل', 300], ['١٠٠', 240], ['جم', 200]),
    row(190, ['منها', 330], ['سكريات', 270], ['٨', 200], ['جم', 160]),
    row(250, ['ألياف', 300], ['٣', 200], ['جم', 160]),
  );
  assert.equal(reading(arabic, 'sugarPer100g').value, 8);
  assert.equal(reading(arabic, 'fiberPer100g').value, 3);
});

test('serving size and net content fill sizes with their units', () => {
  const result = read(
    row(10, ['Serving', 10], ['size', 100], ['30', 160], ['g', 190]),
    PER_100_G_HEADER,
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
    row(300, ['Net', 10], ['wt', 60], ['40', 160], ['g', 190]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(reading(result, 'servingSize').value, 30);
  assert.equal(reading(result, 'servingSize').unit, 'g');
  assert.equal(reading(result, 'packageSize').value, 40);
  assert.equal(reading(result, 'packageSize').unit, 'g');
  assert.equal(reading(result, 'proteinPer100g').value, 21);

  const arabic = read(
    PER_100_G_HEADER,
    row(300, ['الوزن', 330], ['الصافي', 260], ['٤٠', 200], ['جم', 160]),
  );
  assert.equal(reading(arabic, 'packageSize').value, 40);
  assert.equal(reading(arabic, 'packageSize').unit, 'g');

  const litres = read(
    row(40, ['per', 160], ['100', 195], ['ml', 230]),
    row(300, ['Net', 10], ['content', 60], ['1.5', 160], ['L', 200]),
  );
  assert.equal(reading(litres, 'packageSize').value, 1.5);
  assert.equal(reading(litres, 'packageSize').unit, 'l');
});

test('a serving-size phrase sharing a row with a heading keeps both', () => {
  const result = read(
    row(
      40,
      ['Serving', 10],
      ['size', 90],
      ['30', 140],
      ['g', 165],
      ['Per', 380],
      ['100', 415],
      ['g', 450],
    ),
    row(120, ['Protein', 10], ['21', 410], ['g', 435]),
  );
  assert.equal(result.outcome, 'ok');
  assert.equal(reading(result, 'servingSize').value, 30);
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('an ambiguous size unit fills no size', () => {
  const result = read(
    PER_100_G_HEADER,
    row(10, ['Serving', 10], ['size', 100], ['1', 160], ['piece', 190]),
    row(300, ['Net', 10], ['wt', 60], ['1.5', 160], ['oz', 200]),
  );
  assert.equal(reading(result, 'servingSize').value, undefined);
  assert.equal(reading(result, 'packageSize').value, undefined);
});

test('a size in the other dimension than the basis needs a check', () => {
  const result = read(
    PER_100_G_HEADER,
    row(10, ['Serving', 10], ['size', 100], ['250', 160], ['ml', 200]),
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
  );
  const serving = reading(result, 'servingSize');
  assert.equal(serving.value, 250);
  assert.equal(serving.status, 'needs-check');
  assert.match(serving.warnings[0], /per 100 g/);
});

test('a scan never reads the product name, brand, category or country', () => {
  const result = read(
    row(10, ['Chipsy', 10], ['Salt', 100], ['&', 160], ['Vinegar', 190]),
    PER_100_G_HEADER,
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
  );
  assert.deepEqual(
    result.readings.map((r) => r.field),
    [
      'caloriesPer100g',
      'proteinPer100g',
      'carbsPer100g',
      'sugarPer100g',
      'fatPer100g',
      'fiberPer100g',
      'sodiumMgPer100',
      'servingSize',
      'packageSize',
    ],
  );
});

test('a unit in a neighbouring column never attaches to a number', () => {
  // "per 100 g | per serving": the per-100 sodium cell prints a bare
  // "0.4" and the serving cell's "g" sits across the column gap.
  const result = read(
    row(
      40,
      ['Per', 160],
      ['100', 195],
      ['g', 230],
      ['Per', 380],
      ['serving', 415],
    ),
    row(300, ['Sodium', 10], ['0.4', 200], ['g', 380]),
  );
  const sodium = reading(result, 'sodiumMgPer100');
  assert.equal(sodium.value, undefined);
  assert.equal(sodium.status, 'not-found');
});

test('a unit far from its number on the same line is not attached', () => {
  const result = read(
    PER_100_G_HEADER,
    row(10, ['Serving', 10], ['size', 100], ['30', 160], ['g', 400]),
    row(120, ['Protein', 10], ['21', 160], ['g', 190]),
  );
  assert.equal(reading(result, 'servingSize').value, undefined);
  assert.equal(reading(result, 'proteinPer100g').value, 21);
});

test('kJ in the per-100 column converts even when kcal is printed only for a serving', () => {
  const result = read(
    row(
      40,
      ['Per', 160],
      ['100', 195],
      ['g', 230],
      ['Per', 380],
      ['serving', 415],
    ),
    row(
      80,
      ['Energy', 10],
      ['1046', 180],
      ['kJ', 225],
      ['75', 400],
      ['kcal', 425],
    ),
  );
  const calories = reading(result, 'caloriesPer100g');
  assert.equal(calories.value, 250);
  assert.equal(calories.conversion, 'from-kj');
});

test('an unreadable kcal never falls back to the kJ number beside it', () => {
  const result = reader.readLabel({
    words: [
      ...PER_100_G_HEADER,
      ...row(80, ['Energy', 10], ['1046', 160], ['kJ', 210]),
      {
        text: '250',
        bbox: { x0: 250, y0: 80, x1: 280, y1: 100 },
        confidence: 95,
        numberCheck: 'unverified',
      },
      ...row(80, ['kcal', 290]),
    ],
  });
  const calories = reading(result, 'caloriesPer100g');
  assert.equal(calories.value, undefined);
  assert.equal(calories.status, 'not-found');
});

test('the salt note appears only when no sodium row is printed', () => {
  const unreadSodium = reader.readLabel({
    words: [
      ...PER_100_G_HEADER,
      ...row(300, ['Salt', 10], ['1', 160], ['g', 190]),
      ...row(330, ['Sodium', 10]),
      {
        text: '0.4',
        bbox: { x0: 160, y0: 330, x1: 190, y1: 350 },
        confidence: 95,
        numberCheck: 'unverified',
      },
      ...row(330, ['g', 200]),
    ],
  });
  const sodium = reading(unreadSodium, 'sodiumMgPer100');
  assert.equal(sodium.value, undefined);
  assert.equal(
    sodium.warnings.some((w) => /salt/i.test(w)),
    false,
  );
});
