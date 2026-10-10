import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// A real photographed table: a bilingual cookie label (grid lines round every
// cell, a white-on-dark title bar, glossy foil) held about 3.5° off level, as
// recognised by the app's own pipeline from the cleaned copy of the photo
// (labelCleanup.ts + ocrEngine.ts) and mapped back onto the photo, so the
// words are as tilted as the photo was. The photo itself is not committed.
// What is printed on it, per 100 g:
const PRINTED = {
  caloriesPer100g: 415.932,
  proteinPer100g: 6.51,
  carbsPer100g: 83.651,
  sugarPer100g: 11.6,
  fatPer100g: 6.232,
  fiberPer100g: 0.2,
  sodiumMgPer100: 78.76,
};

let vite;
let reader;
const layout = JSON.parse(
  readFileSync('test/fixtures/cookie-label-layout.json', 'utf-8'),
);

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

test('the tilted table is recognised as per 100 g', () => {
  const result = reader.readLabel(layout);
  assert.equal(result.outcome, 'ok');
  assert.equal(result.basisSuggestion, 'PER_100_G');
  assert.equal(result.weakScan, undefined);
});

test('no value marked read differs from what the label prints', () => {
  const { readings } = reader.readLabel(layout);
  for (const reading of readings) {
    if (reading.status !== 'read') continue;
    assert.ok(reading.field in PRINTED, `${reading.field} is not on the label`);
    assert.ok(
      Math.abs(reading.value - PRINTED[reading.field]) < 1e-9,
      `${reading.field} read as ${reading.value}, label prints ${PRINTED[reading.field]}`,
    );
  }
});

test('protein, carbohydrates, sugars and fat are read, each from its own row', () => {
  const { readings } = reader.readLabel(layout);
  const read = (field) => readings.find((r) => r.field === field);
  for (const field of [
    'proteinPer100g',
    'carbsPer100g',
    'sugarPer100g',
    'fatPer100g',
  ]) {
    assert.equal(read(field).status, 'read', field);
    assert.equal(read(field).value, PRINTED[field]);
  }
  // Rows are not chained: protein's evidence is the protein row, not a run
  // of neighbouring rows' text.
  assert.match(read('proteinPer100g').evidence.rowText, /^Protein\(g\) 6\.51/);
  assert.doesNotMatch(read('proteinPer100g').evidence.rowText, /Fat|Sugars/);
  assert.match(read('fatPer100g').evidence.rowText, /^Total Fat\(g\) 6\.232/);
  assert.doesNotMatch(read('fatPer100g').evidence.rowText, /Saturated|Trans/);
});

test('numbers that could not be confirmed twice are left empty, not guessed', () => {
  const { readings } = reader.readLabel(layout);
  // Calories read 415.937 on the page and 415.932 on the re-read; fibre's
  // "0.2" lost its point to glare and showed as "02".
  for (const field of ['caloriesPer100g', 'fiberPer100g']) {
    assert.notEqual(readings.find((r) => r.field === field).status, 'read');
  }
});
