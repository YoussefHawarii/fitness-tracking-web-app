import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Combining Tesseract's English and Arabic passes and verifying numbers by
// an independent re-read. Word fixtures mirror what Tesseract.js returned
// for rendered Arabic, English and bilingual labels.

let vite;
let passes;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  passes = await vite.ssrLoadModule(
    '/src/features/label-scan/recognitionPasses.ts',
  );
});

after(async () => {
  await vite.close();
});

function word(text, x0, y0, width, confidence = 95) {
  return { text, bbox: { x0, y0, x1: x0 + width, y1: y0 + 28 }, confidence };
}

test('Arabic words replace English-pass gibberish read from Arabic text', () => {
  const merged = passes.mergeRecognitionPasses(
    [word('Protein', 30, 180, 110, 96), word('Cig', 978, 186, 80, 8)],
    [word('البروتين', 978, 186, 85, 92)],
  );
  assert.deepEqual(
    merged.map((w) => w.text).sort(),
    ['Protein', 'البروتين'].sort(),
  );
});

test('confident English words survive Arabic-pass gibberish read from them', () => {
  const merged = passes.mergeRecognitionPasses(
    [word('Nutrition', 33, 24, 150, 96)],
    // The Arabic model reads "Nutrition" as Arabic-looking letters.
    [word('صمنتالا', 33, 24, 150, 60), word('نالا', 40, 24, 60, 10)],
  );
  assert.deepEqual(
    merged.map((w) => w.text),
    ['Nutrition'],
  );
});

test('an Arabic-pass number is added only where nothing else was read', () => {
  const merged = passes.mergeRecognitionPasses(
    [word('21', 500, 186, 40, 65)],
    [
      word('1', 515, 186, 20, 95), // truncated reading of the same "21"
      word('40', 500, 256, 40, 90), // nothing in the English pass here
      word('7', 200, 24, 15, 20), // below the noise floor
    ],
  );
  assert.deepEqual(merged.map((w) => w.text).sort(), ['21', '40']);
});

test('directional marks Tesseract wraps around numbers are removed', () => {
  const merged = passes.mergeRecognitionPasses(
    [],
    [word('‎250‏', 500, 116, 50, 94)],
  );
  assert.equal(merged[0].text, '250');
});

test('a number is verified only when the re-read agrees digit for digit', () => {
  const page = { ...word('21g', 481, 187, 60, 66), recognizedBy: 'english' };
  const agrees = passes.verifyNumberWord(page, [word('21g', 481, 187, 60, 90)]);
  assert.equal(agrees.numberCheck, 'verified');
  assert.equal(agrees.text, '21g');

  // A dropped decimal point in either reading is a disagreement.
  for (const [pageText, rereadText] of [
    ['1259', '125g'],
    ['12.5g', '125g'],
    ['1', '21'], // truncated by the Arabic pass
  ]) {
    const result = passes.verifyNumberWord(
      { ...word(pageText, 481, 327, 70, 90), recognizedBy: 'english' },
      [word(rereadText, 481, 327, 70, 90)],
    );
    assert.equal(
      result.numberCheck,
      'unverified',
      `${pageText} vs ${rereadText}`,
    );
  }
});

test('a re-read with no number, or several, leaves the number unverified', () => {
  const page = word('21', 500, 186, 40);
  assert.equal(passes.verifyNumberWord(page, []).numberCheck, 'unverified');
  assert.equal(
    passes.verifyNumberWord(page, [word('ex', 500, 186, 40)]).numberCheck,
    'unverified',
  );
  assert.equal(
    passes.verifyNumberWord(page, [
      word('2', 495, 186, 10),
      word('21', 505, 186, 30),
    ]).numberCheck,
    'unverified',
  );
});

test('Arabic-Indic digits are never verified', () => {
  const result = passes.verifyNumberWord(word('٢١', 500, 186, 40), [
    word('21', 500, 186, 40),
  ]);
  assert.equal(result.numberCheck, 'unverified');
});

test('verification confirms digits but never changes the page text', () => {
  const fused = passes.verifyNumberWord(word('21جم', 500, 186, 60), [
    word('21', 500, 186, 30),
  ]);
  assert.equal(fused.numberCheck, 'verified');
  assert.equal(fused.text, '21جم');

  // The re-read sees a unit the page pass didn't: it must not be added.
  const unitless = passes.verifyNumberWord(word('250', 480, 116, 50), [
    word('250', 480, 116, 50),
    word('kcal', 520, 116, 60),
  ]);
  assert.equal(unitless.numberCheck, 'verified');
  assert.equal(unitless.text, '250');
});

test('end to end: an Arabic-Indic value is never read from a live scan', async () => {
  const reader = await vite.ssrLoadModule(
    '/src/features/label-scan/labelReader.ts',
  );
  const page = [
    word('لكل', 300, 40, 40),
    word('100', 240, 40, 40),
    word('جم', 200, 40, 30),
    word('دهون', 300, 120, 50),
    word('١٢٫٥', 200, 120, 50),
    word('جم', 150, 120, 30),
  ];
  // What the engine does to every digit-bearing word; the English re-read
  // of Arabic-Indic digits is irrelevant — they are never verified.
  const verified = page.map((w) =>
    /\d|[٠-٩]/.test(w.text) ? passes.verifyNumberWord(w, [{ ...w }]) : w,
  );
  const result = reader.readLabel({ words: verified });
  const fat = result.readings.find((r) => r.field === 'fatPer100g');
  assert.equal(result.outcome, 'ok');
  assert.equal(fat.status, 'not-found');
  assert.equal(fat.value, undefined);
});

test('the re-read region widens around a possibly truncated number', () => {
  const crop = passes.numberCrop(
    { x0: 515, y0: 186, x1: 535, y1: 214 },
    1100,
    600,
  );
  assert.deepEqual(crop, { left: 445, top: 175, width: 160, height: 50 });
  const clamped = passes.numberCrop({ x0: 5, y0: 2, x1: 25, y1: 30 }, 60, 40);
  assert.equal(clamped.left, 0);
  assert.equal(clamped.top, 0);
  assert.equal(clamped.left + clamped.width <= 60, true);
});

test('an unverified number in a layout is never read by the Label reader', async () => {
  const reader = await vite.ssrLoadModule(
    '/src/features/label-scan/labelReader.ts',
  );
  const header = [
    word('per', 160, 40, 30),
    word('100', 195, 40, 30),
    word('g', 230, 40, 10),
  ];
  const result = reader.readLabel({
    words: [
      ...header,
      word('Protein', 10, 120, 70),
      { ...word('21', 160, 120, 20), numberCheck: 'unverified' },
      word('g', 190, 120, 10),
    ],
  });
  const protein = result.readings.find((r) => r.field === 'proteinPer100g');
  assert.equal(protein.status, 'not-found');
  assert.equal(protein.value, undefined);
});
