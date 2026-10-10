import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// Two guards on numbers that the cleaned-up reading of a glary, blurry photo
// made necessary: a decimal point lost to glare must never turn "0.2" into
// "2" ("02" is what the photo then shows), and a point read as a comma by one
// of the two readings is still the same number (ADR 0010).

let vite;
let reader;
let passes;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [reader, passes] = await Promise.all([
    vite.ssrLoadModule('/src/features/label-scan/labelReader.ts'),
    vite.ssrLoadModule('/src/features/label-scan/recognitionPasses.ts'),
  ]);
});

after(async () => {
  await vite.close();
});

const word = (text, x0, y0 = 10, width = text.length * 10) => ({
  text,
  bbox: { x0, y0, x1: x0 + width, y1: y0 + 20 },
  confidence: 95,
});

test('a whole number with a leading zero is never read', () => {
  assert.deepEqual(reader.parseLabelNumber('02'), { ambiguous: true });
  assert.deepEqual(reader.parseLabelNumber('007'), { ambiguous: true });
  assert.deepEqual(reader.parseLabelNumber('0'), {
    value: 0,
    ambiguous: false,
  });
  assert.deepEqual(reader.parseLabelNumber('0.2'), {
    value: 0.2,
    ambiguous: false,
  });
  assert.deepEqual(reader.parseLabelNumber('0,2'), {
    value: 0.2,
    ambiguous: false,
  });
  assert.deepEqual(reader.parseLabelNumber('20'), {
    value: 20,
    ambiguous: false,
  });
});

test('fibre printed "02" on the photo is left for the user, not read as 2 g', () => {
  const result = reader.readLabel({
    words: [
      word('per', 100, 10),
      word('100', 140, 10),
      word('g', 180, 10),
      word('Fiber', 10, 50),
      word('(g)', 70, 50),
      word('02', 160, 50),
    ],
  });
  const fiber = result.readings.find((r) => r.field === 'fiberPer100g');
  assert.equal(fiber.status, 'not-found');
  assert.equal(fiber.value, undefined);
});

test('a point read as a comma by one reading still agrees with the other', () => {
  const page = word('78,76', 100);
  const verified = passes.verifyNumberWord(page, [word('78.76', 100)]);
  assert.equal(verified.numberCheck, 'verified');
  // The page text is kept as read; the reader takes either mark as a point.
  assert.equal(verified.text, '78,76');
});

test('readings that differ in a digit or lose the point still do not agree', () => {
  const page = word('415.932', 100);
  assert.equal(
    passes.verifyNumberWord(page, [word('415.937', 100)]).numberCheck,
    'unverified',
  );
  assert.equal(
    passes.verifyNumberWord(page, [word('415932', 100)]).numberCheck,
    'unverified',
  );
  assert.equal(
    passes.verifyNumberWord(word('4.15', 100), [word('415', 100)]).numberCheck,
    'unverified',
  );
});

// An energy figure read one digit off ("415.033" for a printed 415.932) is
// inside the 10 kcal the energy check allows against the kJ figure, so only
// the two-readings rule can stop it (ADR 0010).
function energyTable(energyWord) {
  return {
    words: [
      word('per', 100, 10),
      word('100', 140, 10),
      word('g', 180, 10),
      word('Energy', 10, 50),
      word('(kcal)', 80, 50),
      { ...word('415.033', 160, 50), ...energyWord },
      word('kcal', 230, 50),
      word('1740', 280, 50),
      word('kJ', 330, 50),
    ],
  };
}

test('an energy figure whose re-read disagrees on a digit is not read', () => {
  const page = word('415.033', 160, 50);
  const disagreed = passes.verifyNumberWord(page, [word('415.932', 160, 50)]);
  assert.equal(disagreed.numberCheck, 'unverified');

  const result = reader.readLabel(
    energyTable({ numberCheck: disagreed.numberCheck }),
  );
  const energy = result.readings.find((r) => r.field === 'caloriesPer100g');
  assert.notEqual(energy.status, 'read');
  assert.equal(energy.value, undefined);
});

// This documents the limit of the rule, not a desired outcome: if both
// readings share the same wrong digits they agree and the figure is read. Only
// the independence of the two readings (the re-read cut from the copy before
// grid-line removal, and no re-read where the erasure touched the ink) makes
// that unlikely.
test('the same energy figure is read when both readings agree', () => {
  const page = word('415.033', 160, 50);
  const agreed = passes.verifyNumberWord(page, [word('415.033', 160, 50)]);
  assert.equal(agreed.numberCheck, 'verified');

  const result = reader.readLabel(
    energyTable({ numberCheck: agreed.numberCheck }),
  );
  const energy = result.readings.find((r) => r.field === 'caloriesPer100g');
  assert.equal(energy.status, 'read');
  assert.equal(energy.value, 415.033);
});
