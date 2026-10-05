// Developer-only: turns the owner's own label photos into Label reader
// regression fixtures (ticket #39). Served by the dev server at
// /scripts/label-fixture/ and never part of the production build, which
// bundles only the app's index.html — the shipped app has no OCR export or
// debug path.
//
// It runs exactly the app's pipeline, in a real browser: the photo is
// prepared as the app prepares it (orientation, resize, grayscale), then
// recognised by the app's on-device engine with the self-hosted language
// data. Nothing is uploaded; each fixture is saved by the browser as a
// download. See docs/label-scan-release-checks.md for the workflow.

import { createTesseractEngine } from '../../src/features/label-scan/ocrEngine';
import { prepareLabelImage } from '../../src/features/label-scan/prepareImage';
import type { OcrLayout } from '../../src/features/label-scan/ocrLayout';

const TODO = 'TODO';

function fixtureTemplate(photoName: string, layout: OcrLayout) {
  return {
    label: `TODO: product and language, e.g. "Brand X oat biscuits, bilingual" (from ${photoName})`,
    // 'english' | 'arabic' | 'bilingual'
    language: TODO,
    truth: {
      // What the label's own header states: 'per-100g' | 'per-100ml' |
      // 'per-serving-only'.
      basis: TODO,
      // true only for a sharp, flat, well-lit photo — the 80% recall
      // target is measured on these.
      clear: TODO,
      // Every value as printed on the label: per 100 (sodium in mg,
      // calories in kcal), serving and package size as numbers in the
      // label's unit. null for anything the label does not print.
      values: {
        caloriesPer100g: TODO,
        proteinPer100g: TODO,
        carbsPer100g: TODO,
        sugarPer100g: TODO,
        fatPer100g: TODO,
        fiberPer100g: TODO,
        sodiumMgPer100: TODO,
        servingSize: TODO,
        packageSize: TODO,
      },
    },
    layout,
  };
}

function save(name: string, data: unknown) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(data, null, 2)}\n`], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

const log = document.getElementById('log')!;
const input = document.getElementById('photos') as HTMLInputElement;

input.addEventListener('change', async () => {
  const photos = [...(input.files ?? [])];
  if (photos.length === 0) return;
  input.disabled = true;
  const engine = await createTesseractEngine(() => undefined);
  try {
    for (const photo of photos) {
      const started = performance.now();
      const layout = await engine.recognize(await prepareLabelImage(photo));
      const name = photo.name
        .replace(/\.[^.]+$/, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
      save(`${name}.json`, fixtureTemplate(photo.name, layout));
      log.textContent += `${photo.name} → ${name}.json (${layout.words.length} words, ${Math.round(performance.now() - started)} ms)\n`;
    }
  } catch (err) {
    log.textContent += `Failed: ${err instanceof Error ? err.name : 'error'}\n`;
  } finally {
    await engine.terminate();
    input.disabled = false;
    input.value = '';
  }
});
