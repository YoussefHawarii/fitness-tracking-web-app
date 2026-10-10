import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// A photographed table is rarely level. At a few degrees of tilt the far end
// of a row sits more than a row's spacing away from its start, so rows must
// be told apart by where their neighbouring words are, not by one growing
// band of height. Fixtures place the words of a table the way a tilted photo
// would, to the pixel.

let vite;
let reader;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  reader = await vite.ssrLoadModule('/src/features/label-scan/labelReader.ts');
});

after(async () => {
  await vite.close();
});

const CHAR_WIDTH = 10;

// One visual row at height y on a photo tilted by `slope` (pixels of drop per
// pixel across); each item is [text, x].
function row(y, slope, ...items) {
  return items.map(([text, x]) => {
    const drop = Math.round(x * slope);
    return {
      text,
      bbox: {
        x0: x,
        y0: y + drop,
        x1: x + text.length * CHAR_WIDTH,
        y1: y + drop + 20,
      },
      confidence: 95,
    };
  });
}

// A per 100 g table with rows 36 px apart and 20 px tall: at a tilt of 0.06
// (3.4°), a row's words 440 px apart differ by 26 px in height.
function table(slope) {
  return [
    row(10, slope, ['Nutrition', 10], ['per', 200], ['100', 240], ['g', 280]),
    row(46, slope, ['Energy', 10], ['(kcal)', 90], ['352', 400], ['kcal', 440]),
    row(82, slope, ['Protein', 10], ['(g)', 90], ['21', 400], ['g', 430]),
    row(
      118,
      slope,
      ['Carbohydrate', 10],
      ['(g)', 140],
      ['40', 400],
      ['g', 430],
    ),
    row(154, slope, ['Fat', 10], ['(g)', 60], ['12', 400], ['g', 430]),
  ].flat();
}

function values(result) {
  return Object.fromEntries(
    result.readings
      .filter((r) =>
        [
          'caloriesPer100g',
          'proteinPer100g',
          'carbsPer100g',
          'fatPer100g',
        ].includes(r.field),
      )
      .map((r) => [r.field, r.status === 'read' ? r.value : null]),
  );
}

const EXPECTED = {
  caloriesPer100g: 352,
  proteinPer100g: 21,
  carbsPer100g: 40,
  fatPer100g: 12,
};

test('a level table reads as before', () => {
  const result = reader.readLabel({ words: table(0) });
  assert.equal(result.outcome, 'ok');
  assert.deepEqual(values(result), EXPECTED);
});

for (const slope of [0.06, -0.06, 0.1]) {
  test(`a table tilted by ${slope} keeps its rows apart and reads the same values`, () => {
    const result = reader.readLabel({ words: table(slope) });
    assert.equal(result.outcome, 'ok');
    assert.equal(result.basisSuggestion, 'PER_100_G');
    assert.deepEqual(values(result), EXPECTED);
    // Each reading's evidence is its own row, not a run of neighbours.
    const protein = result.readings.find((r) => r.field === 'proteinPer100g');
    assert.equal(protein.evidence.rowText, 'Protein (g) 21 g');
  });
}

test('rows that really are one line of text stay together on a tilt', () => {
  // "Protein 21 g" and "Fat 12 g" side by side on one line of a tilted photo.
  const words = [
    ...row(10, 0.06, ['Nutrition', 10], ['per', 300], ['100', 340], ['g', 380]),
    ...row(
      50,
      0.06,
      ['Protein', 10],
      ['21', 120],
      ['g', 150],
      ['Fat', 300],
      ['12', 360],
      ['g', 390],
    ),
  ];
  const result = reader.readLabel({ words });
  const value = (field) => result.readings.find((r) => r.field === field);
  assert.equal(value('proteinPer100g').value, 21);
  assert.equal(value('fatPer100g').value, 12);
});

test('a single word, and no words, do not break row grouping', () => {
  assert.doesNotThrow(() => reader.readLabel({ words: [] }));
  assert.doesNotThrow(() =>
    reader.readLabel({
      words: [
        {
          text: 'Protein',
          bbox: { x0: 0, y0: 0, x1: 70, y1: 20 },
          confidence: 90,
        },
      ],
    }),
  );
});

// Words read from a straightened copy: the photo box (what the review shows)
// is tilted, the copy box (what the reader groups rows by) is level.
function copyRow(y, slope, ...items) {
  return row(y, slope, ...items).map((word, i) => ({
    ...word,
    layoutBox: {
      x0: items[i][1],
      y0: y,
      x1: items[i][1] + items[i][0].length * CHAR_WIDTH,
      y1: y + 20,
    },
  }));
}

test('a value far to the right of its label stays on its row of a tilted photo, by the copy boxes', () => {
  // Value columns 700 px from the labels, rows 36 px apart, on a photo
  // tilted by 0.08: the value of a row sits 56 px lower than its label on the
  // photo, a row and a half. Few neighbouring words, so the tilt can't be
  // measured from the photo boxes alone.
  const slope = 0.08;
  const words = [
    ...copyRow(10, slope, ['per', 300], ['100', 340], ['g', 380]),
    ...copyRow(46, slope, ['Protein', 10], ['21', 700], ['g', 730]),
    ...copyRow(82, slope, ['Fat', 10], ['12', 700], ['g', 730]),
    ...copyRow(118, slope, ['Fiber', 10], ['3', 700], ['g', 730]),
  ];
  const result = reader.readLabel({ words });
  assert.equal(result.outcome, 'ok');
  const read = (field) => result.readings.find((r) => r.field === field);
  assert.equal(read('proteinPer100g').value, 21);
  assert.equal(read('fatPer100g').value, 12);
  assert.equal(read('fiberPer100g').value, 3);
  // The evidence boxes are on the photo, where the words are drawn there.
  const evidence = read('proteinPer100g').evidence;
  assert.equal(evidence.rowText, 'Protein 21 g');
  assert.equal(evidence.bbox.x0, 700);
  assert.equal(evidence.bbox.x1, 730 + 10);
  assert.equal(evidence.bbox.y0, 46 + Math.round(700 * slope));
  assert.equal(evidence.bbox.y1, 46 + Math.round(730 * slope) + 20);
});

// A word at [x, y0, y1] of any height.
const tall = (text, x, y0, y1) => ({
  text,
  bbox: { x0: x, y0, x1: x + text.length * CHAR_WIDTH, y1 },
  confidence: 95,
});

test('a tall box does not pull the next, closely spaced row into its row', () => {
  // The "(kcal)" box reaches 15 px above and 30 px below its row (stray
  // marks round the word), down over the next row, which starts to its
  // right. Rows are 36 px apart.
  const words = [
    ...row(10, 0, ['per', 200], ['100', 240], ['g', 280]),
    tall('Energy', 10, 46, 66),
    tall('(kcal)', 90, 31, 96),
    tall('352', 400, 46, 66),
    tall('kcal', 440, 46, 66),
    tall('Protein', 150, 82, 102),
    tall('21', 400, 82, 102),
    tall('g', 430, 82, 102),
  ];
  const result = reader.readLabel({ words });
  const read = (field) => result.readings.find((r) => r.field === field);
  assert.equal(read('caloriesPer100g').value, 352);
  assert.equal(read('proteinPer100g').value, 21);
  assert.equal(read('proteinPer100g').evidence.rowText, 'Protein 21 g');
});
