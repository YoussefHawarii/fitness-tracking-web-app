// Developer-only: turns the owner's own label photos into Label reader
// regression fixtures (ticket #39). It runs the app's real on-device engine
// (src/features/label-scan/ocrEngine.ts) in Node against the same language
// data the app ships, entirely on this machine — nothing is fetched or
// uploaded. It lives outside src/ and is never part of the app: the shipped
// app has no OCR export or debug path.
//
//   node scripts/label-fixture.mjs <photo.png|photo.jpg> [...more photos]
//
// Photos must be upright and at most 2000 px on the longest side, as the
// app prepares them (see prepareImage.ts) — export a resized copy first.
//
// Each photo becomes test/fixtures/labels/pending/<name>.json (gitignored)
// holding the recognised layout and a "truth" block of TODOs. Fill the
// truth in from the printed label — never from the OCR output — review the
// whole file, then move it up into test/fixtures/labels/ to commit it.
// Photos are not copied anywhere.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_SIDE = 2000;
const LANGUAGES = ['eng', 'ara'];
const LANGUAGE_DATA_SET = '4.0.0_best_int';
const PENDING_DIR = join(ROOT, 'test', 'fixtures', 'labels', 'pending');

function imageSize(bytes) {
  // PNG: width and height follow the IHDR chunk type.
  if (bytes.readUInt32BE(0) === 0x89504e47) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  // JPEG: the first start-of-frame segment holds the size.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset < bytes.length) {
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        return {
          height: bytes.readUInt16BE(offset + 5),
          width: bytes.readUInt16BE(offset + 7),
        };
      }
      offset += 2 + length;
    }
  }
  throw new Error('Only PNG and JPEG photos are supported.');
}

function fixtureTemplate(photo, layout) {
  const todo = 'TODO';
  return {
    label: `TODO: product and language, e.g. "Brand X oat biscuits, bilingual" (from ${basename(photo)})`,
    // 'english' | 'arabic' | 'bilingual'
    language: todo,
    truth: {
      // What the label's own header states: 'per-100g' | 'per-100ml' |
      // 'per-serving-only'.
      basis: todo,
      // true only for a sharp, flat, well-lit photo — the 80% recall target
      // is measured on these.
      clear: todo,
      // The values printed on the label, per 100 (sodium in mg; calories in
      // kcal). Use null for a value the label does not print.
      values: {
        caloriesPer100g: todo,
        proteinPer100g: todo,
        carbsPer100g: todo,
        sugarPer100g: todo,
        fatPer100g: todo,
        fiberPer100g: todo,
        sodiumMgPer100: todo,
      },
    },
    layout,
  };
}

async function main() {
  const photos = process.argv.slice(2);
  if (photos.length === 0) {
    console.error('Usage: node scripts/label-fixture.mjs <photo> [...]');
    process.exit(2);
  }

  const work = mkdtempSync(join(tmpdir(), 'label-fixture-'));
  const langPath = join(work, 'tessdata');
  mkdirSync(langPath);
  for (const lang of LANGUAGES) {
    copyFileSync(
      join(
        ROOT,
        'node_modules',
        '@tesseract.js-data',
        lang,
        LANGUAGE_DATA_SET,
        `${lang}.traineddata.gz`,
      ),
      join(langPath, `${lang}.traineddata.gz`),
    );
  }

  // The app's engine module, with its asset paths pointed at local files;
  // Node's own Tesseract worker and engine come from node_modules.
  const vite = await createServer({
    root: ROOT,
    configFile: false,
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
    optimizeDeps: { noDiscovery: true, include: [] },
    define: {
      __OCR_ASSETS__: JSON.stringify({
        workerPath: join(
          ROOT,
          'node_modules',
          'tesseract.js',
          'src',
          'worker-script',
          'node',
          'index.js',
        ),
        langPath,
        cachePath: join(work, 'cache'),
      }),
      __OCR_LANGUAGES__: JSON.stringify(LANGUAGES),
    },
  });

  let sizeOfCurrent;
  globalThis.createImageBitmap = async () => ({ ...sizeOfCurrent, close() {} });

  let engine;
  try {
    const { createTesseractEngine } = await vite.ssrLoadModule(
      '/src/features/label-scan/ocrEngine.ts',
    );
    engine = await createTesseractEngine(() => undefined);
    mkdirSync(PENDING_DIR, { recursive: true });

    for (const photo of photos) {
      const bytes = readFileSync(photo);
      sizeOfCurrent = imageSize(bytes);
      const { width, height } = sizeOfCurrent;
      if (Math.max(width, height) > MAX_SIDE) {
        console.error(
          `${photo}: ${width}×${height} px — resize to at most ${MAX_SIDE} px on the longest side first.`,
        );
        process.exitCode = 1;
        continue;
      }
      const layout = await engine.recognize(bytes);
      const name = basename(photo, extname(photo))
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
      const out = join(PENDING_DIR, `${name}.json`);
      if (existsSync(out)) {
        console.error(`${out} already exists — not overwritten.`);
        process.exitCode = 1;
        continue;
      }
      writeFileSync(
        out,
        `${JSON.stringify(fixtureTemplate(photo, layout), null, 2)}\n`,
      );
      console.log(`${photo} → ${out} (${layout.words.length} words)`);
    }
  } finally {
    await engine?.terminate();
    await vite.close();
    rmSync(work, { recursive: true, force: true });
  }
}

await main();
