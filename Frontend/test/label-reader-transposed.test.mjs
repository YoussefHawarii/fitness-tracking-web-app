import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

let vite;
let reader;
before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  reader = await vite.ssrLoadModule(
    process.env.LABEL_READER_MODULE ??
      '/src/features/label-scan/labelReader.ts',
  );
});
after(async () => vite.close());

const w = (text, x, y, width = text.length * 8, numberCheck) => ({
  text,
  bbox: { x0: x, y0: y, x1: x + width, y1: y + 20 },
  confidence: 95,
  ...(numberCheck && { numberCheck }),
});
const title = () => [
  w('Nutrition', 0, 0),
  w('Facts', 100, 0),
  w('حقائق', 200, 0),
  w('غذائية', 260, 0),
  w('Per', 500, 0),
  w('100g', 540, 0),
  w('جم', 630, 0),
  w('١٠٠', 680, 0),
  w('لكل', 720, 0),
];
const headings = () => [
  w('Protein/100g', 10, 40, 120),
  w('Fat/100g', 180, 40, 90),
  w('Carbs/100g', 350, 40, 110),
  w('Energy', 550, 40, 65),
  w('Kcal', 620, 40, 45),
];
const arabic = () => [
  w('بروتين', 20, 65, 70),
  w('(جم)', 95, 65, 35),
  w('دهون', 190, 65, 50),
  w('كلية', 245, 65, 45),
  w('(جم)', 290, 65, 30),
  w('كربوهيدرات', 355, 65, 100),
  w('(جم)', 460, 65, 35),
  w('سعرات', 560, 65, 60),
  w('حرارية', 625, 65, 60),
  w('(كالوري)', 690, 65, 70),
];
const values = () => [
  w('5.9', 45, 100, 30, 'verified'),
  w('٥.٩', 80, 100, 30, 'unverified'),
  w('13.9', 205, 100, 40, 'verified'),
  w('١٣.٩', 250, 100, 40, 'unverified'),
  w('61', 380, 100, 25, 'verified'),
  w('٦١', 410, 100, 25, 'unverified'),
  w('419', 580, 100, 35, 'verified'),
  w('٤١٩', 620, 100, 35, 'unverified'),
];
const footer = () => [
  w('the', 10, 160),
  w('Daily', 50, 160),
  w('Value', 105, 160),
  w('tells', 165, 160),
  w('you', 220, 160),
  w('how', 260, 160),
  w('much', 310, 160),
  w('a', 365, 160),
  w('nutrient', 380, 160),
  w('in', 465, 160),
  w('a', 490, 160),
  w('serving', 505, 160),
  w('of', 580, 160),
  w('food', 605, 160),
  w('2000', 45, 220),
  w('calories', 100, 220),
  w('a', 190, 220),
  w('day', 210, 220),
  w('is', 250, 220),
  w('used', 280, 220),
  w('for', 330, 220),
  w('general', 370, 220),
  w('nutrition', 450, 220),
  w('advice', 540, 220),
];
const layout = () => [
  ...title(),
  ...headings(),
  ...arabic(),
  ...values(),
  ...footer(),
];
const scan = (words) => reader.readLabel({ words });
const field = (result, name) => result.readings.find((r) => r.field === name);
const macros = [
  'proteinPer100g',
  'fatPer100g',
  'carbsPer100g',
  'caloriesPer100g',
];

test('bilingual nutrient columns read four values with photo evidence', () => {
  const result = scan(layout());
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  for (const [name, expected, unit] of [
    ['proteinPer100g', 5.9, 'g'],
    ['fatPer100g', 13.9, 'g'],
    ['carbsPer100g', 61, 'g'],
    ['caloriesPer100g', 419, 'kcal'],
  ]) {
    assert.equal(field(result, name).value, expected);
    assert.equal(field(result, name).unit, unit);
    assert.equal(field(result, name).status, 'read', name);
    assert.equal(field(result, name).evidence.bbox.y0, 40);
    assert.equal(field(result, name).evidence.bbox.y1, 120);
  }
});

test('Arabic-Indic copies do not confirm or cause several values', () => {
  const result = scan(layout());
  assert.equal(result.outcome, 'ok');
  assert.equal(field(result, 'proteinPer100g').value, 5.9);
  assert.equal(field(result, 'fatPer100g').value, 13.9);
  assert.equal(
    field(result, 'proteinPer100g').confirmedInBothLanguages,
    undefined,
  );
  assert.ok(
    result.readings.every(
      (r) => !r.warnings.some((warning) => warning.includes('Several values')),
    ),
  );
});

test('real OCR damage leaves uncertain cells blank', () => {
  const words = layout().filter(
    (item) => item.bbox.y0 !== 100 && item.text !== 'Fat/100g',
  );
  words.push(
    w('JFat/100g', 180, 40, 100),
    w('596', 45, 100, 30, 'unverified'),
    w('61/1', 380, 100, 40, 'verified'),
    w('419', 580, 100, 35, 'unverified'),
  );
  const result = scan(words);
  for (const name of macros) assert.equal(field(result, name).value, undefined);
});

test('footer serving prose does not invalidate a normal row table', () => {
  const result = scan([
    ...title(),
    w('Protein', 10, 50),
    w('5.9', 160, 50),
    w('g', 200, 50),
    w('Fat', 10, 85),
    w('13.9', 160, 85),
    w('g', 210, 85),
    ...footer(),
  ]);
  assert.equal(result.outcome, 'ok');
  assert.equal(field(result, 'proteinPer100g').value, 5.9);
});

for (const text of ['Protein/100g', 'Protein per 100 g']) {
  test(`${text} without a value never reads its basis number`, () => {
    const result = scan([...title(), w(text, 10, 50, 180, 'verified')]);
    assert.equal(field(result, 'proteinPer100g').value, undefined);
    assert.equal(field(result, 'proteinPer100g').status, 'not-found');
  });
}

test('a slash separated from 100 g is still basis text, while a value of 100 g reads', () => {
  const basis = scan([
    ...title(),
    w('Protein', 10, 50),
    w('/', 90, 50, 10),
    w('100', 105, 50, 30, 'verified'),
    w('g', 140, 50),
  ]);
  assert.equal(field(basis, 'proteinPer100g').value, undefined);
  const value = scan([
    ...title(),
    w('Protein', 10, 50),
    w('100', 160, 50, 30, 'verified'),
    w('g', 195, 50),
  ]);
  assert.equal(field(value, 'proteinPer100g').value, 100);
});

test('heading basis disagreeing with title leaves that nutrient blank', () => {
  const words = layout();
  words.find((item) => item.text === 'Protein/100g').text = 'Protein/100ml';
  const result = scan(words);
  assert.equal(field(result, 'proteinPer100g').value, undefined);
  assert.equal(field(result, 'fatPer100g').value, 13.9);
});

test('footer numbers cannot replace an empty value row', () => {
  const result = scan([
    ...title(),
    ...headings(),
    ...arabic(),
    w('|', 50, 100),
    w('|', 580, 100),
    w('2000', 45, 190),
    w('10', 580, 190),
  ]);
  assert.equal(field(result, 'proteinPer100g').value, undefined);
  assert.equal(field(result, 'caloriesPer100g').value, undefined);
});

test('a value straddling the Fat/Carbs boundary leaves both cells blank', () => {
  const words = layout().filter(
    (item) => !['13.9', '١٣.٩', '61', '٦١'].includes(item.text),
  );
  words.push(w('13.9', 295, 100, 35, 'verified'));
  const result = scan(words);
  assert.equal(field(result, 'fatPer100g').value, undefined);
  assert.equal(field(result, 'carbsPer100g').value, undefined);
});

test('a per-serving heading never fills per-100 cells', () => {
  const words = layout();
  words.find((item) => item.text === 'Fat/100g').text = 'Fat/serving';
  const result = scan(words);
  for (const name of macros) assert.equal(field(result, name).value, undefined);
});

test('a second nutrient heading row below values leaves the table unresolved', () => {
  const second = headings().map((item) => ({
    ...item,
    bbox: { ...item.bbox, y0: 260, y1: 280 },
  }));
  const result = scan([...layout(), ...second]);
  assert.equal(result.outcome, 'no-per-100-column');
  assert.ok(result.readings.every((item) => item.value === undefined));
});

test('English and Arabic heading units disagree, so the cell stays blank', () => {
  const words = layout();
  words.find((item) => item.text === '(جم)' && item.bbox.x0 === 95).text =
    '(ملغ)';
  const result = scan(words);
  assert.equal(field(result, 'proteinPer100g').value, undefined);
  assert.equal(field(result, 'fatPer100g').value, 13.9);
});

test('tilted layout uses level copy boxes and reports photo-space evidence', () => {
  const words = layout().map((item) => ({
    ...item,
    layoutBox: { ...item.bbox },
    bbox: {
      ...item.bbox,
      y0: item.bbox.y0 + Math.round(item.bbox.x0 * 0.06),
      y1: item.bbox.y1 + Math.round(item.bbox.x0 * 0.06),
    },
  }));
  const result = scan(words);
  assert.equal(result.outcome, 'ok');
  for (const [name, expected] of [
    ['proteinPer100g', 5.9],
    ['fatPer100g', 13.9],
    ['carbsPer100g', 61],
    ['caloriesPer100g', 419],
  ])
    assert.equal(field(result, name).value, expected);
  assert.equal(
    field(result, 'caloriesPer100g').evidence.bbox.y1,
    120 + Math.round(580 * 0.06),
  );
});

test('energy headed only in kJ is left blank', () => {
  const words = layout();
  words.find((item) => item.text === 'Kcal').text = 'kJ';
  words.find((item) => item.text === '(كالوري)').text = '(كيلوجول)';
  const result = scan(words);
  assert.equal(field(result, 'caloriesPer100g').value, undefined);
  assert.equal(field(result, 'proteinPer100g').value, 5.9);
  assert.equal(field(result, 'fatPer100g').value, 13.9);
});

test('title with per-serving and per-100 phrases cannot select the first numeric row', () => {
  const servingTitle = [
    w('Per', 10, 0),
    w('serving', 50, 0),
    w('(30g)', 120, 0),
    w('Per', 500, 0),
    w('100g', 540, 0),
  ];
  const servingValues = [
    w('1.8', 45, 100, 30),
    w('4.2', 205, 100, 30),
    w('18', 380, 100, 25),
    w('126', 580, 100, 35),
  ];
  const per100Values = values()
    .filter((item) => !/[٠-٩]/.test(item.text))
    .map((item) => ({
      ...item,
      bbox: { ...item.bbox, y0: 130, y1: 150 },
    }));
  const result = scan([
    ...servingTitle,
    ...headings(),
    ...arabic(),
    ...servingValues,
    ...per100Values,
  ]);
  assert.equal(result.outcome, 'no-per-100-column');
  for (const name of macros) assert.equal(field(result, name).value, undefined);
});

test('two numeric rows under transposed headings are unresolved', () => {
  const second = values()
    .filter((item) => !/[٠-٩]/.test(item.text))
    .map((item) => ({
      ...item,
      bbox: { ...item.bbox, y0: 130, y1: 150 },
    }));
  const result = scan([
    ...title(),
    ...headings(),
    ...arabic(),
    ...values(),
    ...second,
  ]);
  assert.equal(result.outcome, 'no-per-100-column');
  for (const name of macros) assert.equal(field(result, name).value, undefined);
});

test('Arabic serving wording in the title blocks transposed per-100 reads', () => {
  const result = scan([
    ...title(),
    w('للحصة', 390, 0, 70),
    ...headings(),
    ...arabic(),
    ...values(),
  ]);
  assert.equal(result.outcome, 'no-per-100-column');
  for (const name of macros) assert.equal(field(result, name).value, undefined);
});

test('a fieldless saturates column cannot supply a missing fat value', () => {
  const words = [
    ...title(),
    w('Protein/100g', 10, 40, 110),
    w('Fat/100g', 170, 40, 80),
    w('Saturates/100g', 280, 40, 125),
    w('Carbs/100g', 450, 40, 110),
    w('Energy', 650, 40, 65),
    w('Kcal', 720, 40, 45),
    w('5.9', 45, 100, 30),
    w('3.1', 315, 100, 30),
    w('61', 480, 100, 25),
    w('419', 680, 100, 35),
  ];
  const result = scan(words);
  assert.equal(result.outcome, 'no-per-100-column');
  assert.equal(field(result, 'fatPer100g').value, undefined);
});

for (const extraHeading of [
  'Saturates/100g',
  'Salt/100g',
  'Trans/100g',
  'Cholesterol/100g',
  'ملح/100g',
]) {
  test(`${extraHeading} owns a band when all five cells are present`, () => {
    const words = [
      ...title(),
      w('Protein/100g', 10, 40, 110),
      w('Fat/100g', 170, 40, 80),
      w(extraHeading, 280, 40, 125),
      w('Carbs/100g', 450, 40, 110),
      w('Energy', 650, 40, 65),
      w('Kcal', 720, 40, 45),
      w('5.9', 45, 100, 30),
      w('13.9', 195, 100, 40),
      w('3.1', 315, 100, 30),
      w('61', 480, 100, 25),
      w('419', 680, 100, 35),
    ];
    const result = scan(words);
    assert.equal(result.outcome, 'ok');
    assert.equal(field(result, 'fatPer100g').value, 13.9);
    assert.equal(field(result, 'carbsPer100g').value, 61);
    assert.equal(field(result, 'caloriesPer100g').value, 419);
  });
}

test('a dropped heading leaves a cell-count mismatch unresolved', () => {
  const words = layout().filter((item) => item.text !== 'Fat/100g');
  const result = scan(words);
  assert.equal(result.outcome, 'no-per-100-column');
  for (const name of macros) assert.equal(field(result, name).value, undefined);
});

test('a stray value beyond the outermost heading cannot fill Protein', () => {
  const words = layout().filter((item) => item.text !== '5.9');
  words.push(w('99', -180, 100, 25));
  const result = scan(words);
  assert.equal(field(result, 'proteinPer100g').value, undefined);
  assert.equal(field(result, 'fatPer100g').value, 13.9);
});

for (const variant of ['<0.5', '< 0.5', 'less than 0.5', 'أقل من 0.5']) {
  test(`${variant} is a bound, never an exact transposed value`, () => {
    const words = layout().filter(
      (item) => !['5.9', '٥.٩'].includes(item.text),
    );
    if (variant === '<0.5') words.push(w('<0.5', 45, 100, 45));
    if (variant === '< 0.5')
      words.push(w('<', 35, 100, 10), w('0.5', 50, 100, 35));
    if (variant === 'less than 0.5')
      words.push(
        w('less', 10, 100, 35),
        w('than', 50, 100, 35),
        w('0.5', 90, 100, 35),
      );
    if (variant === 'أقل من 0.5')
      words.push(
        w('0.5', 25, 100, 35),
        w('من', 65, 100, 25),
        w('أقل', 95, 100, 35),
      );
    const result = scan(words);
    assert.equal(field(result, 'proteinPer100g').value, undefined);
    assert.match(
      field(result, 'proteinPer100g').warnings.join(' '),
      /less than/,
    );
    assert.equal(field(result, 'fatPer100g').value, 13.9);
  });
}

test('percent cells never become nutrient amounts', () => {
  const words = layout().filter((item) => item.bbox.y0 !== 100);
  words.push(
    w('12%', 45, 100, 35),
    w('20%', 205, 100, 35),
    w('22%', 380, 100, 35),
    w('21%', 580, 100, 35),
  );
  const result = scan(words);
  for (const name of macros) assert.equal(field(result, name).value, undefined);
});

test('Sodium/100g without an explicit nutrient unit never reads 35 as grams', () => {
  const words = [
    ...title(),
    w('Protein/100g', 10, 40, 120),
    w('Fat/100g', 180, 40, 90),
    w('Carbs/100g', 350, 40, 110),
    w('Sodium/100g', 550, 40, 120),
    w('5', 45, 100),
    w('10', 205, 100),
    w('20', 380, 100),
    w('35', 580, 100),
  ];
  const result = scan(words);
  assert.equal(field(result, 'sodiumMgPer100').value, undefined);
  assert.equal(field(result, 'proteinPer100g').value, 5);
});

test('an explicit mg unit in the sodium heading reads milligrams without conversion', () => {
  const words = [
    ...title(),
    w('Protein/100g', 10, 40, 120),
    w('Fat/100g', 180, 40, 90),
    w('Carbs/100g', 350, 40, 110),
    w('Sodium/100g', 550, 40, 120),
    w('(mg)', 675, 40, 40),
    w('5', 45, 100),
    w('10', 205, 100),
    w('20', 380, 100),
    w('35', 580, 100),
  ];
  const result = scan(words);
  assert.equal(result.outcome, 'ok');
  assert.equal(field(result, 'sodiumMgPer100').value, 35);
  assert.equal(field(result, 'sodiumMgPer100').unit, 'mg');
  assert.equal(field(result, 'sodiumMgPer100').conversion, undefined);
});

test('gram nutrients with only /100g as unit evidence need checking', () => {
  const words = [
    ...title(),
    ...headings(),
    ...values().filter((item) => !/[٠-٩]/.test(item.text)),
  ];
  const result = scan(words);
  for (const name of ['proteinPer100g', 'fatPer100g', 'carbsPer100g']) {
    assert.equal(field(result, name).status, 'needs-check');
    assert.match(
      field(result, name).warnings.join(' '),
      /Unit not read — assumed g/,
    );
  }
  assert.equal(field(result, 'caloriesPer100g').value, 419);
});

test('an ingredients line above a normal row table does not pre-empt it', () => {
  const words = [
    w('Ingredients:', 10, 0),
    w('sugar', 130, 0),
    w('palm', 210, 0),
    w('fat', 260, 0),
    w('milk', 310, 0),
    w('protein', 365, 0),
    w('2026', 30, 40),
    ...title().map((item) => ({
      ...item,
      bbox: { ...item.bbox, y0: 80, y1: 100 },
    })),
    w('Energy', 10, 130),
    w('419', 160, 130),
    w('kcal', 210, 130),
    w('Protein', 10, 165),
    w('5.9', 160, 165),
    w('g', 205, 165),
    w('Fat', 10, 200),
    w('13.9', 160, 200),
    w('g', 205, 200),
    w('Carbs', 10, 235),
    w('61', 160, 235),
    w('g', 205, 235),
  ];
  const result = scan(words);
  assert.equal(result.outcome, 'ok');
  for (const [name, value] of [
    ['proteinPer100g', 5.9],
    ['fatPer100g', 13.9],
    ['carbsPer100g', 61],
    ['caloriesPer100g', 419],
  ])
    assert.equal(field(result, name).value, value);
});

test('ingredients below a real transposed table do not become a second heading', () => {
  const words = [
    ...layout(),
    w('Ingredients:', 10, 260),
    w('sugar', 130, 260),
    w('palm', 210, 260),
    w('fat', 260, 260),
    w('milk', 310, 260),
    w('protein', 365, 260),
    w('2026', 45, 300),
  ];
  const result = scan(words);
  assert.equal(result.outcome, 'ok');
  assert.equal(field(result, 'proteinPer100g').value, 5.9);
  assert.equal(field(result, 'fatPer100g').value, 13.9);
});

test('a straddling value blanks both neighbours even when their own values are present', () => {
  const words = layout().filter(
    (item) => item.text !== '419' && item.text !== '٤١٩',
  );
  words.push(w('7.7', 295, 100, 35));
  const result = scan(words);
  for (const name of ['fatPer100g', 'carbsPer100g']) {
    assert.equal(field(result, name).value, undefined);
    assert.match(field(result, name).warnings.join(' '), /column/);
  }
});

for (const text of ['Protein/30g', 'Protein(30g)', 'Protein per 30 g']) {
  test(`${text} is not a row-table nutrient value`, () => {
    const result = scan([...title(), w(text, 10, 50, 150)]);
    assert.equal(field(result, 'proteinPer100g').value, undefined);
    assert.match(
      field(result, 'proteinPer100g').warnings.join(' '),
      /per 30 g/,
    );
  });
  test(`${text} makes a transposed table per-serving and unresolved`, () => {
    const words = layout();
    words.find((item) => item.text === 'Protein/100g').text = text;
    const result = scan(words);
    assert.equal(result.outcome, 'no-per-100-column');
    for (const name of macros)
      assert.equal(field(result, name).value, undefined);
    assert.match(
      field(result, 'proteinPer100g').warnings.join(' '),
      /per 30 g/,
    );
  });
}

test('a value beyond the widened Carbs heading cannot replace a dropped carbs cell', () => {
  const words = [
    ...title(),
    w('Protein/100g', 10, 40, 120),
    w('Fat/100g', 180, 40, 90),
    w('Carbs/100g', 350, 40, 110),
    w('Energy', 650, 40, 65),
    w('Kcal', 720, 40, 45),
    w('5.9', 45, 100, 30),
    w('13.9', 205, 100, 40),
    w('22', 510, 100, 25),
    w('419', 680, 100, 35),
  ];
  const result = scan(words);
  assert.equal(result.outcome, 'ok');
  assert.equal(field(result, 'carbsPer100g').value, undefined);
  assert.equal(field(result, 'proteinPer100g').value, 5.9);
  assert.equal(field(result, 'caloriesPer100g').value, 419);
});

test('an Arabic gram unit cannot widen Carbs into a dropped Sugars cell', () => {
  const result = scan([
    ...title(),
    w('Protein/100g', 10, 40, 120),
    w('Fat/100g', 180, 40, 90),
    w('Carbs/100g', 350, 40, 110),
    w('Energy', 650, 40, 65),
    w('Kcal', 720, 40, 45),
    w('بروتين', 20, 65, 70),
    w('(جم)', 95, 65, 35),
    w('دهون', 190, 65, 50),
    w('(جم)', 245, 65, 35),
    w('كربوهيدرات', 355, 65, 100),
    w('(جم)', 460, 65, 35),
    w('سعرات', 665, 65, 60),
    w('(كالوري)', 730, 65, 70),
    w('5.9', 45, 100, 30, 'verified'),
    w('13.9', 205, 100, 40, 'verified'),
    w('22', 500, 100, 25, 'verified'),
    w('237', 680, 100, 35, 'verified'),
  ]);
  assert.equal(result.outcome, 'ok');
  assert.equal(field(result, 'carbsPer100g').value, undefined);
  assert.notEqual(field(result, 'carbsPer100g').status, 'read');
  assert.equal(field(result, 'proteinPer100g').value, 5.9);
  assert.equal(field(result, 'caloriesPer100g').value, 237);
});

test('an unmatched Arabic sugars sub-heading blocks its column', () => {
  const words = [
    ...title(),
    w('Protein/100g', 10, 40, 120),
    w('Fat/100g', 180, 40, 90),
    w('Carbs/100g', 350, 40, 110),
    w('Energy', 650, 40, 65),
    w('Kcal', 720, 40, 45),
    w('بروتين', 20, 65, 70),
    w('(جم)', 95, 65, 35),
    w('دهون', 190, 65, 50),
    w('(جم)', 245, 65, 35),
    w('كربوهيدرات', 355, 65, 100),
    w('(جم)', 460, 65, 35),
    w('سكريات', 500, 65, 65),
    w('(جم)', 570, 65, 35),
    w('سعرات', 665, 65, 60),
    w('(كالوري)', 730, 65, 70),
    w('5.9', 45, 100, 30, 'verified'),
    w('13.9', 205, 100, 40, 'verified'),
    w('22', 500, 100, 25, 'verified'),
    w('237', 680, 100, 35, 'verified'),
  ];
  const result = scan(words);
  assert.equal(field(result, 'carbsPer100g').value, undefined);
  assert.notEqual(field(result, 'carbsPer100g').status, 'read');
});

for (const [first, second] of [
  ['5g/', '25g'],
  ['25g/', '5g'],
]) {
  test(`Sugars ${first} ${second} has several values, not one`, () => {
    const result = scan([
      ...title(),
      w('Sugars', 10, 50),
      w(first, 160, 50),
      w(second, 210, 50),
    ]);
    assert.equal(field(result, 'sugarPer100g').value, undefined);
    assert.match(
      field(result, 'sugarPer100g').warnings.join(' '),
      /Several values/,
    );
  });
}

for (const extraValue of [undefined, '5g']) {
  test(`Protein (30g) as separate words is basis, with ${extraValue ?? 'no value'}`, () => {
    const result = scan([
      ...title(),
      w('Protein', 10, 50),
      w('(30g)', 100, 50),
      ...(extraValue ? [w(extraValue, 200, 50)] : []),
    ]);
    assert.equal(field(result, 'proteinPer100g').value, undefined);
    assert.equal(field(result, 'proteinPer100g').status, 'not-found');
    assert.match(
      field(result, 'proteinPer100g').warnings.join(' '),
      /per 30 g/,
    );
  });
}

for (const [label, row, name] of [
  [
    'Protein (30g) 6g',
    [w('Protein', 10, 50), w('(30g)', 100, 50), w('6g', 200, 50)],
    'proteinPer100g',
  ],
  [
    'Protein per 30 g 6 g',
    [
      w('Protein', 10, 50),
      w('per', 100, 50),
      w('30', 150, 50),
      w('g', 185, 50),
      w('6', 230, 50),
      w('g', 265, 50),
    ],
    'proteinPer100g',
  ],
  [
    'Protein/30g 6g',
    [w('Protein/30g', 10, 50, 120), w('6g', 200, 50)],
    'proteinPer100g',
  ],
  [
    'Energy (per 30g) 120 kcal',
    [
      w('Energy', 10, 50),
      w('(per 30g)', 100, 50, 90),
      w('120', 230, 50),
      w('kcal', 280, 50),
    ],
    'caloriesPer100g',
  ],
]) {
  test(`${label} never supplies a per-100 value`, () => {
    const result = scan([...title(), ...row]);
    assert.equal(field(result, name).status, 'not-found');
    assert.equal(field(result, name).value, undefined);
    assert.match(field(result, name).warnings.join(' '), /per 30 g/);
  });
}

test('a row marked per serving cannot fill a per-100 nutrient', () => {
  const result = scan([
    ...title(),
    w('Protein', 10, 50),
    w('per', 100, 50),
    w('serving', 140, 50),
    w('6g', 220, 50),
  ]);
  assert.equal(field(result, 'proteinPer100g').status, 'not-found');
  assert.equal(field(result, 'proteinPer100g').value, undefined);
  assert.match(
    field(result, 'proteinPer100g').warnings.join(' '),
    /per serving/,
  );
});

for (const [label, row, name, expected] of [
  [
    'Sugars 5g/ 100g',
    [w('Sugars', 10, 50), w('5g/', 160, 50), w('100g', 210, 50)],
    'sugarPer100g',
    5,
  ],
  [
    'Energy (kcal) 400',
    [w('Energy', 10, 50), w('(kcal)', 100, 50), w('400', 200, 50)],
    'caloriesPer100g',
    400,
  ],
  [
    'Fat (g) 12',
    [w('Fat', 10, 50), w('(g)', 100, 50), w('12', 200, 50)],
    'fatPer100g',
    12,
  ],
]) {
  test(`${label} stays readable`, () => {
    const result = scan([...title(), ...row]);
    assert.equal(field(result, name).value, expected);
    assert.equal(field(result, name).status, 'read', name);
  });
}

test('split basis words widen each English heading for right-aligned values', () => {
  const result = scan([
    ...title(),
    w('Protein', 10, 40, 40),
    w('/100g', 60, 40, 60),
    w('Fat', 190, 40, 30),
    w('/100g', 225, 40, 50),
    w('Carbs', 350, 40, 50),
    w('/100g', 405, 40, 50),
    w('Energy', 550, 40, 65),
    w('Kcal', 620, 40, 45),
    w('5.9', 100, 100, 20, 'verified'),
    w('13.9', 265, 100, 20, 'verified'),
    w('61', 380, 100, 25, 'verified'),
    w('419', 580, 100, 35, 'verified'),
  ]);
  assert.equal(result.outcome, 'ok');
  for (const [name, value] of [
    ['proteinPer100g', 5.9],
    ['fatPer100g', 13.9],
    ['carbsPer100g', 61],
    ['caloriesPer100g', 419],
  ])
    assert.equal(field(result, name).value, value);
});

test('wide Arabic sub-headings keep units with their own nutrient', () => {
  const result = scan([
    ...title(),
    ...headings(),
    w('بروتين', 20, 65, 155),
    w('(جم)', 150, 65, 40),
    w('دهون', 190, 65, 70),
    w('(جم)', 250, 65, 40),
    w('كربوهيدرات', 355, 65, 150),
    w('(جم)', 480, 65, 40),
    w('سعرات', 560, 65, 60),
    w('(كالوري)', 650, 65, 70),
    ...values(),
  ]);
  assert.equal(result.outcome, 'ok');
  assert.equal(field(result, 'proteinPer100g').value, 5.9);
  assert.equal(field(result, 'proteinPer100g').status, 'read');
  assert.equal(field(result, 'caloriesPer100g').value, 419);
  assert.equal(field(result, 'caloriesPer100g').status, 'read');
});

for (const value of [['30g'], ['30', 'g']]) {
  test(`Protein ${value.join(' ')} remains a genuine value`, () => {
    const result = scan([
      ...title(),
      w('Protein', 10, 50),
      ...value.map((text, i) => w(text, 160 + i * 45, 50)),
    ]);
    assert.equal(field(result, 'proteinPer100g').value, 30);
    assert.equal(field(result, 'proteinPer100g').status, 'read');
  });
}
