import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Real-label regression fixtures (ticket #39): layouts recognised from the
// owner's own retail-label photos by scripts/label-fixture.mjs, each with
// the values printed on the label filled in by hand. They sit alongside
// the hand-authored synthetic cases in label-reader.test.mjs and hold the
// Label reader to its release targets:
//   - no wrong value is ever marked "read" (a wrong "needs check" is fine);
//   - a per-serving-only label never fills a per-100 field;
//   - on clear photos, at least 80% of calories/protein/carbs/fat are read.

const DIR = join('test', 'fixtures', 'labels');
const MACROS = [
  'caloriesPer100g',
  'proteinPer100g',
  'carbsPer100g',
  'fatPer100g',
];
const RECALL_TARGET = 0.8;
// A calorie value converted from kJ is compared to the printed kcal to
// within rounding.
const KJ_CONVERSION_TOLERANCE = 1;

const fixtures = (() => {
  let files = [];
  try {
    files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
  } catch {
    // No fixtures directory yet.
  }
  return files.map((file) => ({
    file,
    ...JSON.parse(readFileSync(join(DIR, file), 'utf-8')),
  }));
})();

let reader;

before(async () => {
  if (fixtures.length === 0) return;
  const vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  reader = await vite.ssrLoadModule('/src/features/label-scan/labelReader.ts');
  after(() => vite.close());
});

function sameValue(reading, printed) {
  const tolerance =
    reading.conversion === 'from-kj' ? KJ_CONVERSION_TOLERANCE : 1e-9;
  return Math.abs(reading.value - printed) <= tolerance;
}

if (fixtures.length === 0) {
  test('real-label fixtures', {
    skip: 'none committed yet — generate them with scripts/label-fixture.mjs',
  });
}

for (const fixture of fixtures) {
  const { file, truth, layout } = fixture;

  test(`${file}: is reviewed and well-formed`, () => {
    assert.doesNotMatch(
      JSON.stringify({ ...fixture, layout: undefined }),
      /TODO/,
      'fill in every TODO from the printed label before committing',
    );
    assert.ok(['english', 'arabic', 'bilingual'].includes(fixture.language));
    assert.ok(
      ['per-100g', 'per-100ml', 'per-serving-only'].includes(truth.basis),
    );
    assert.equal(typeof truth.clear, 'boolean');
    for (const [field, value] of Object.entries(truth.values)) {
      assert.ok(reader.LABEL_FIELDS.includes(field), field);
      assert.ok(value === null || typeof value === 'number', field);
    }
    assert.ok(Array.isArray(layout.words) && layout.words.length > 0);
  });

  test(`${file}: no wrong value is marked read`, () => {
    const result = reader.readLabel(layout);
    for (const reading of result.readings) {
      if (reading.status !== 'read') continue;
      const printed = truth.values[reading.field];
      if (printed === undefined) continue; // serving and package sizes
      assert.ok(
        printed !== null && sameValue(reading, printed),
        `${reading.field} read as ${reading.value}, label prints ${printed}`,
      );
    }
  });

  if (truth.basis === 'per-serving-only') {
    test(`${file}: per-serving values never fill per-100 fields`, () => {
      const { outcome } = reader.readLabel(layout);
      assert.ok(
        outcome === 'per-serving-only' || outcome === 'no-per-100-column',
        `outcome ${outcome}`,
      );
    });
  }
}

const clear = fixtures.filter(
  (f) => f.truth.clear === true && f.truth.basis !== 'per-serving-only',
);
if (clear.length > 0) {
  test('clear labels: at least 80% of the main values are read', () => {
    let printed = 0;
    let read = 0;
    for (const { truth, layout } of clear) {
      const result = reader.readLabel(layout);
      for (const field of MACROS) {
        if (typeof truth.values[field] !== 'number') continue;
        printed += 1;
        const reading = result.readings.find((r) => r.field === field);
        if (
          reading?.status === 'read' &&
          sameValue(reading, truth.values[field])
        ) {
          read += 1;
        }
      }
    }
    assert.ok(
      read / printed >= RECALL_TARGET,
      `${read} of ${printed} main values read`,
    );
  });
}
