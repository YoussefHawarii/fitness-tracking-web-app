import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// The real on-device engine module driven against a recording stand-in for
// tesseract.js: it configures every OCR asset on this origin, hands the
// photo only to the worker, and makes no request of its own — through a
// scan, its number re-reads and termination. Requests made inside the real
// Tesseract runtime are outside this test; the clean-profile network
// inspection on real devices covers them.

let vite;
let engineModule;
let fake;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
    // The alias below confuses dependency pre-bundling, which SSR module
    // loading doesn't need.
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: {
      alias: {
        'tesseract.js': fileURLToPath(
          new URL('./fixtures/fake-tesseract.mjs', import.meta.url),
        ),
      },
    },
  });
  engineModule = await vite.ssrLoadModule(
    '/src/features/label-scan/ocrEngine.ts',
  );
  fake = await vite.ssrLoadModule('/test/fixtures/fake-tesseract.mjs');
});

after(async () => {
  await vite.close();
});

test('the engine configures same-origin OCR assets and makes no request of its own', async () => {
  const requests = [];
  const saved = {
    fetch: globalThis.fetch,
    createImageBitmap: globalThis.createImageBitmap,
    XMLHttpRequest: globalThis.XMLHttpRequest,
    sendBeacon: globalThis.navigator?.sendBeacon,
  };
  globalThis.fetch = async (url) => {
    requests.push(String(url));
    throw new Error('no network in this test');
  };
  globalThis.XMLHttpRequest = class {
    open(method, url) {
      requests.push(`${method} ${url}`);
    }
    send() {}
  };
  globalThis.createImageBitmap = async () => ({
    width: 1000,
    height: 600,
    close() {},
  });

  const progress = [];
  const photo = new Blob(['photo bytes'], { type: 'image/png' });
  try {
    const engine = await engineModule.createTesseractEngine((p) =>
      progress.push(p),
    );
    const layout = await engine.recognize(photo);
    await engine.terminate();
    assert.ok(layout.words.length > 0);
  } finally {
    Object.assign(globalThis, {
      fetch: saved.fetch,
      createImageBitmap: saved.createImageBitmap,
      XMLHttpRequest: saved.XMLHttpRequest,
    });
  }

  // No request was made by the app's engine code itself.
  assert.deepEqual(requests, []);

  // The worker loads its script, engine and language data from /ocr/ on
  // this origin, from a same-origin script rather than a blob: URL.
  const [created] = fake.calls.filter((c) => c.type === 'createWorker');
  const { options } = created;
  for (const key of ['workerPath', 'corePath', 'langPath']) {
    assert.match(options[key], /^\/ocr\//, key);
  }
  assert.equal(options.workerBlobURL, false);
  assert.deepEqual(created.langs, ['eng', 'ara']);

  // The photo goes only to the worker — every recognition gets the Blob
  // itself, never a URL or an encoded copy.
  const recognitions = fake.calls.filter((c) => c.type === 'recognize');
  assert.ok(recognitions.length >= 3); // English, Arabic, a number re-read
  for (const call of recognitions) assert.equal(call.image, photo);
  assert.ok(recognitions.some((c) => c.options?.rectangle));
  assert.equal(fake.calls.at(-1).type, 'terminate');

  // Progress carries a stage and a fraction, never recognised text.
  for (const p of progress) {
    assert.deepEqual(Object.keys(p).sort(), ['progress', 'stage']);
  }
});

// Runs one scan with the given recognize options and returns the layout
// and the recognitions it asked of the worker, split into the two
// language page passes and the number re-reads (single-line mode 7).
async function scan(options) {
  const saved = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({
    width: 1000,
    height: 600,
    close() {},
  });
  const photo = new Blob(['photo bytes'], { type: 'image/png' });
  const start = fake.calls.length;
  try {
    const engine = await engineModule.createTesseractEngine(() => {});
    const layout =
      options === undefined
        ? await engine.recognize(photo)
        : await engine.recognize(photo, options);
    await engine.terminate();
    const recognitions = fake.calls
      .slice(start)
      .filter((c) => c.type === 'recognize');
    return {
      layout,
      photo,
      pagePasses: recognitions.filter((c) => c.pageSegMode !== '7'),
      numberRereads: recognitions.filter((c) => c.pageSegMode === '7'),
    };
  } finally {
    globalThis.createImageBitmap = saved;
  }
}

const fakeWord = (text, x0, y0) => ({
  text,
  confidence: 95,
  bbox: { x0, y0, x1: x0 + 40, y1: y0 + 20 },
});

test('with a region, both language passes read only that rectangle as one block', async () => {
  const region = { left: 200, top: 150, width: 500, height: 300 };
  // Tesseract reports words read inside a rectangle in full-photo pixels.
  fake.setWords([fakeWord('Protein', 250, 200), fakeWord('21', 600, 200)]);
  try {
    const { layout, photo, pagePasses, numberRereads } = await scan({
      region,
    });

    assert.deepEqual(
      pagePasses.map((c) => c.language),
      ['eng', 'ara'],
    );
    for (const pass of pagePasses) {
      assert.equal(pass.pageSegMode, '6');
      assert.deepEqual(pass.options?.rectangle, region);
      assert.equal(pass.image, photo);
    }

    // The words come back where Tesseract found them on the photo.
    const bboxOf = (text) => layout.words.find((w) => w.text === text)?.bbox;
    assert.deepEqual(bboxOf('Protein'), { x0: 250, y0: 200, x1: 290, y1: 220 });
    assert.deepEqual(bboxOf('21'), { x0: 600, y0: 200, x1: 640, y1: 220 });

    // The number is still re-read on its own, from a crop around it
    // inside the photo (not the region), and that re-read confirms it.
    assert.equal(numberRereads.length, 1);
    const crop = numberRereads[0].options.rectangle;
    assert.notDeepEqual(crop, region);
    assert.ok(crop.left <= 600 && crop.left + crop.width >= 640);
    assert.ok(crop.top <= 200 && crop.top + crop.height >= 220);
    assert.ok(crop.left >= 0 && crop.top >= 0);
    assert.ok(crop.left + crop.width <= 1000 && crop.top + crop.height <= 600);
    assert.equal(
      layout.words.find((w) => w.text === '21')?.numberCheck,
      'verified',
    );
  } finally {
    fake.setWords();
  }
});

test('the sparse layout reads the whole photo in sparse-text mode', async () => {
  const { layout, pagePasses } = await scan({ layout: 'sparse' });

  assert.deepEqual(
    pagePasses.map((c) => c.language),
    ['eng', 'ara'],
  );
  for (const pass of pagePasses) {
    assert.equal(pass.pageSegMode, '11');
    assert.equal(pass.options?.rectangle, undefined);
  }
  assert.ok(layout.words.length > 0);
});

test('with no options, both language passes read the whole photo in automatic mode', async () => {
  const { pagePasses } = await scan();

  assert.deepEqual(
    pagePasses.map((c) => c.language),
    ['eng', 'ara'],
  );
  for (const pass of pagePasses) {
    assert.equal(pass.pageSegMode, '3');
    assert.equal(pass.options?.rectangle, undefined);
  }
});
