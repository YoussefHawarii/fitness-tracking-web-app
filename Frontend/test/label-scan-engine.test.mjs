import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// The real on-device engine module driven against a recording stand-in for
// tesseract.js: every OCR asset it asks for is on this origin, the photo
// goes only to the in-browser worker, and nothing it does makes a request
// of its own — through a scan, its number re-reads and termination.

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

test('a scan asks only for same-origin OCR assets and sends nothing anywhere', async () => {
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
