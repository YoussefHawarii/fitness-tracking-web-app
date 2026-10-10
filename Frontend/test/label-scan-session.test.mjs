import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// Label-scan session seam: the scanning lifecycle driven with a fake OCR
// engine — loading and progress, load failure and retry, the crop step
// (read a region cut from the original photo, or the whole photo, with one
// sparse fallback pass), a photo already framed by the label camera, cancel
// and retake mid-run, stale results, one reused worker, and releasing the
// worker and the photo. Tesseract never runs here.

let vite;
let sessionModule;
let prepareModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [sessionModule, prepareModule] = await Promise.all([
    vite.ssrLoadModule('/src/features/label-scan/labelScanSession.ts'),
    vite.ssrLoadModule('/src/features/label-scan/prepareImage.ts'),
  ]);
});

after(async () => {
  await vite.close();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A clean per 100 g label layout the real Label reader turns into readings.
function word(text, x0, y0) {
  return {
    text,
    bbox: { x0, y0, x1: x0 + text.length * 10, y1: y0 + 20 },
    confidence: 95,
  };
}
const LAYOUT = {
  words: [
    word('per', 160, 40),
    word('100', 195, 40),
    word('g', 230, 40),
    word('Protein', 10, 120),
    word('21', 160, 120),
    word('g', 185, 120),
  ],
};
// Rows with no per 100 header: the reader's outcome is no-per-100-column.
const NO_HEADER = {
  words: [word('Protein', 10, 120), word('21', 160, 120), word('g', 185, 120)],
};
const NO_HEADER_FAT = {
  words: [word('Fat', 10, 120), word('5', 160, 120), word('g', 185, 120)],
};
// The fields a result actually read a value for.
const fieldsRead = (result) =>
  result.readings.filter((r) => r.status === 'read').map((r) => r.field);

// A fake engine factory whose loads and recognitions the test controls.
function fakeDependencies() {
  const engines = [];
  const recognitions = [];
  const shown = [];
  const released = [];
  const prepared = [];
  const crops = [];
  return {
    engines,
    prepared,
    crops,
    recognitions,
    shown,
    released,
    deps: {
      createEngine(onProgress) {
        const load = deferred();
        const engine = {
          terminated: 0,
          recognize(image, options) {
            const job = deferred();
            job.image = image;
            job.options = options;
            recognitions.push(job);
            return job.promise;
          },
          async terminate() {
            engine.terminated += 1;
          },
        };
        engines.push({ load, engine, onProgress });
        return load.promise.then(() => engine);
      },
      prepareImage: async (photo, crop) => {
        if (crop) {
          crops.push({ photo, crop });
          return `crop:${photo}`;
        }
        prepared.push(photo);
        if (photo === 'heic') throw new prepareModule.LabelImageDecodeError();
        return `prepared:${photo}`;
      },
      showImage: async (image) => {
        const url = `blob:${image}:${shown.length}`;
        shown.push(url);
        return { url, width: 1000, height: 600 };
      },
      releaseImage: (url) => released.push(url),
    },
  };
}

test('opening starts loading the engine, with progress, and reuses it', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  assert.equal(session.view().open, true);
  assert.equal(session.view().engine, 'loading');
  await flush();

  fake.engines[0].onProgress({ stage: 'loading', progress: 0.4 });
  assert.deepEqual(session.view().progress, {
    stage: 'loading',
    progress: 0.4,
  });

  fake.engines[0].load.resolve();
  await flush();
  assert.equal(session.view().engine, 'ready');

  session.open();
  void session.scan('a');
  await flush();
  assert.equal(fake.engines.length, 1);
});

test('a failed engine load can be retried', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.reject(new Error('offline'));
  await flush();
  assert.equal(session.view().engine, 'failed');

  session.retry();
  await flush();
  assert.equal(fake.engines.length, 2);
  assert.equal(session.view().engine, 'loading');
  fake.engines[1].load.resolve();
  await flush();
  assert.equal(session.view().engine, 'ready');
});

test('a scan during a failed load reports the load failure', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();
  fake.engines[0].load.reject(new Error('offline'));
  await reading;
  assert.deepEqual(session.view().scan, {
    kind: 'error',
    message: sessionModule.ENGINE_LOAD_FAILED_MESSAGE,
  });
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('reading the whole photo goes recognizing → review with readings and the photo', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();
  assert.equal(session.view().scan.kind, 'recognizing');

  fake.recognitions[0].resolve(LAYOUT);
  await flush();
  assert.equal(fake.recognitions.length, 1);
  await reading;
  const { scan } = session.view();
  assert.equal(scan.kind, 'review');
  assert.equal(scan.result.outcome, 'ok');
  assert.equal(
    scan.result.readings.find((r) => r.field === 'proteinPer100g').value,
    21,
  );
  assert.deepEqual(scan.image, {
    url: 'blob:prepared:a:0',
    width: 1000,
    height: 600,
  });
});

test('cancel mid-recognition terminates the worker and discards the late result', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();

  session.cancel();
  await flush();
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.equal(session.view().open, false);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);

  fake.recognitions[0].resolve(LAYOUT);
  await reading;
  assert.equal(session.view().open, false);
  assert.equal(session.view().scan.kind, 'none');
  assert.deepEqual(fake.shown, ['blob:prepared:a:0']);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('a retake mid-run reuses the worker, waits its turn and ignores the replaced run', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  await session.scan('a');
  const first = session.readWholePhoto();
  await flush();
  await session.scan('b');
  const second = session.readWholePhoto();
  await flush();
  assert.equal(fake.engines.length, 1);
  // Never two recognitions at once on the shared worker.
  assert.equal(fake.recognitions.length, 1);

  // The replaced run finishes: never shown, and only then does the
  // retake start.
  fake.recognitions[0].resolve(LAYOUT);
  await first;
  await flush();
  assert.equal(session.view().scan.kind, 'recognizing');
  assert.equal(fake.recognitions.length, 2);
  fake.recognitions[1].resolve(LAYOUT);
  await second;
  assert.equal(session.view().scan.kind, 'review');
  assert.equal(session.view().scan.image.url, 'blob:prepared:b:1');
  assert.deepEqual(fake.shown, ['blob:prepared:a:0', 'blob:prepared:b:1']);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('a queued run cancelled while it waits never starts', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  await session.scan('a');
  const first = session.readWholePhoto();
  await flush();
  await session.scan('b');
  const second = session.readWholePhoto();
  await flush();
  session.cancel();
  fake.recognitions[0].resolve(LAYOUT);
  await Promise.all([first, second]);
  await flush();
  assert.equal(fake.recognitions.length, 1);
  assert.equal(session.view().open, false);
  assert.deepEqual(fake.released, ['blob:prepared:a:0', 'blob:prepared:b:1']);
});

test('cancelling during the engine load and reopening never runs two workers', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  session.cancel();
  session.open();
  await flush();
  // The replacement waits for the first worker to load and terminate.
  assert.equal(fake.engines.length, 1);
  fake.engines[0].load.resolve();
  await flush();
  await flush();
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.equal(fake.engines.length, 2);
  fake.engines[1].load.resolve();
  await flush();
  assert.equal(session.view().engine, 'ready');
});

test('the review photo is released on retake, cancel and dispose', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  await session.scan('a');
  const first = session.readWholePhoto();
  await flush();
  fake.recognitions[0].resolve(LAYOUT);
  await first;

  const retake = session.scan('b');
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  await retake;
  const second = session.readWholePhoto();
  await flush();
  fake.recognitions[1].resolve(LAYOUT);
  await second;

  session.cancel();
  assert.deepEqual(fake.released, ['blob:prepared:a:0', 'blob:prepared:b:1']);

  session.open();
  await flush();
  fake.engines[1].load.resolve();
  await session.scan('c');
  const third = session.readWholePhoto();
  await flush();
  fake.recognitions[2].resolve(LAYOUT);
  await third;
  session.dispose();
  await flush();
  assert.deepEqual(fake.released, [
    'blob:prepared:a:0',
    'blob:prepared:b:1',
    'blob:prepared:c:2',
  ]);
  assert.equal(fake.engines[1].engine.terminated, 1);
});

test('an undecodable photo shows the format error and keeps scanning open', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  await session.scan('heic');
  assert.deepEqual(session.view().scan, {
    kind: 'error',
    message: sessionModule.IMAGE_FORMAT_MESSAGE,
  });
  assert.equal(session.view().open, true);
});

test('a session never touches browser storage or the network', async () => {
  const touched = [];
  const trap = (name) =>
    new Proxy(
      {},
      {
        get(_, prop) {
          touched.push(`${name}.${String(prop)}`);
          return () => undefined;
        },
      },
    );
  const saved = {
    localStorage: globalThis.localStorage,
    sessionStorage: globalThis.sessionStorage,
    fetch: globalThis.fetch,
  };
  globalThis.localStorage = trap('localStorage');
  globalThis.sessionStorage = trap('sessionStorage');
  globalThis.fetch = (...args) => {
    touched.push(`fetch ${String(args[0])}`);
    return Promise.reject(new Error('no network in this test'));
  };
  try {
    const fake = fakeDependencies();
    const session = sessionModule.createLabelScanSession(fake.deps);
    session.open();
    await flush();
    fake.engines[0].load.resolve();
    await session.scan('a');
    const reading = session.readWholePhoto();
    await flush();
    fake.recognitions[0].resolve(LAYOUT);
    await reading;
    session.cancel();
    session.dispose();
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.deepEqual(touched, []);
});

// The crop step: a chosen photo is shown for cropping first; recognition
// runs only when the user reads a region or the whole photo.

async function readySession() {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  await flush();
  return { fake, session };
}

// Resolves the whole-photo pass with no per-100 column and waits for the
// fallback pass to start.
async function failFirstPass(fake) {
  fake.recognitions[0].resolve(NO_HEADER);
  await flush();
  await flush();
}

test('choosing a photo shows it for cropping and runs no recognition yet', async () => {
  const { fake, session } = await readySession();
  const scanning = session.scan('a');
  assert.equal(session.view().scan.kind, 'preparing');
  await scanning;
  await flush();
  assert.deepEqual(session.view().scan, {
    kind: 'cropping',
    image: { url: 'blob:prepared:a:0', width: 1000, height: 600 },
  });
  assert.equal(fake.recognitions.length, 0);
  assert.deepEqual(fake.released, []);
});

test('reading a region cuts it from the original photo and reads that crop as one block', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  // The shown photo is 1000 x 600; the region is given in its pixels.
  const region = { left: 100, top: 60, width: 400, height: 300 };
  const reading = session.readRegion(region);
  assert.equal(session.view().scan.kind, 'recognizing');
  await flush();
  // Cut from the original photo ('a'), not from the scaled-down copy, as
  // fractions so it means the same area at the original's resolution.
  assert.deepEqual(fake.crops, [
    { photo: 'a', crop: { left: 0.1, top: 0.1, width: 0.4, height: 0.5 } },
  ]);
  assert.equal(fake.recognitions.length, 1);
  assert.equal(fake.recognitions[0].image, 'crop:a');
  assert.deepEqual(fake.recognitions[0].options, { layout: 'block' });

  fake.recognitions[0].resolve(LAYOUT);
  await reading;
  const { scan } = session.view();
  assert.equal(scan.kind, 'review');
  assert.equal(scan.result.outcome, 'ok');
  assert.equal(
    scan.result.readings.find((r) => r.field === 'proteinPer100g').value,
    21,
  );
  // The review shows the crop that was read (the evidence boxes are in its
  // pixels), and the photo shown for cropping is released.
  assert.equal(scan.image.url, 'blob:crop:a:1');
  assert.deepEqual(fake.shown, ['blob:prepared:a:0', 'blob:crop:a:1']);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);

  session.cancel();
  assert.deepEqual(fake.released, ['blob:prepared:a:0', 'blob:crop:a:1']);
});

test('a crop replaced while it is being cut is released and never read', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const gate = deferred();
  const prepare = fake.deps.prepareImage;
  fake.deps.prepareImage = async (photo, crop) => {
    if (crop) await gate.promise;
    return prepare(photo, crop);
  };
  const reading = session.readRegion({
    left: 0,
    top: 0,
    width: 500,
    height: 300,
  });
  await flush();
  await session.scan('b');
  gate.resolve();
  await reading;
  await flush();
  assert.equal(fake.recognitions.length, 0);
  assert.deepEqual(session.view().scan, {
    kind: 'cropping',
    image: { url: 'blob:prepared:b:1', width: 1000, height: 600 },
  });
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('a crop that cannot be cut shows an error and releases the photo', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  fake.deps.prepareImage = async () => {
    throw new Error('out of memory');
  };
  await session.readRegion({ left: 0, top: 0, width: 500, height: 300 });
  assert.deepEqual(session.view().scan, {
    kind: 'error',
    message: sessionModule.IMAGE_FAILED_MESSAGE,
  });
  assert.equal(fake.recognitions.length, 0);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('a framed camera photo is read at once as one block, with no crop step', async () => {
  const { fake, session } = await readySession();
  const kinds = [];
  session.subscribe(() => kinds.push(session.view().scan.kind));
  const reading = session.scanFramed('framed');
  await flush();
  assert.equal(session.view().scan.kind, 'recognizing');
  assert.deepEqual(fake.prepared, ['framed']);
  assert.deepEqual(fake.crops, []);
  assert.equal(fake.recognitions.length, 1);
  assert.equal(fake.recognitions[0].image, 'prepared:framed');
  assert.deepEqual(fake.recognitions[0].options, { layout: 'block' });

  fake.recognitions[0].resolve(LAYOUT);
  await reading;
  const { scan } = session.view();
  assert.equal(scan.kind, 'review');
  assert.equal(scan.image.url, 'blob:prepared:framed:0');
  assert.deepEqual(fieldsRead(scan.result), ['proteinPer100g']);
  assert.ok(!kinds.includes('cropping'));
});

test('a framed photo with no per-100 column gets the sparse fallback pass', async () => {
  const { fake, session } = await readySession();
  const reading = session.scanFramed('framed');
  await flush();
  await failFirstPass(fake);
  assert.equal(fake.recognitions.length, 2);
  assert.deepEqual(fake.recognitions[1].options, { layout: 'sparse' });
  fake.recognitions[1].resolve(LAYOUT);
  await reading;
  assert.equal(session.view().scan.result.outcome, 'ok');
});

test('a framed photo replaces a scan in progress and is released on cancel', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const reading = session.scanFramed('framed');
  await flush();
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  session.cancel();
  fake.recognitions[0].resolve(LAYOUT);
  await reading;
  await flush();
  assert.equal(session.view().open, false);
  assert.deepEqual(fake.released, [
    'blob:prepared:a:0',
    'blob:prepared:framed:1',
  ]);
});

test('an undecodable framed photo shows the format error', async () => {
  const { fake, session } = await readySession();
  await session.scanFramed('heic');
  assert.deepEqual(session.view().scan, {
    kind: 'error',
    message: sessionModule.IMAGE_FORMAT_MESSAGE,
  });
  assert.equal(fake.recognitions.length, 0);
});

test('reading the whole photo with no per-100 column runs one sparse pass and uses it', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();
  assert.equal(fake.recognitions.length, 1);
  assert.equal(fake.recognitions[0].image, 'prepared:a');
  assert.equal(fake.recognitions[0].options, undefined);

  await failFirstPass(fake);
  assert.equal(session.view().scan.kind, 'recognizing');
  assert.equal(fake.recognitions.length, 2);
  assert.equal(fake.recognitions[1].image, 'prepared:a');
  assert.deepEqual(fake.recognitions[1].options, { layout: 'sparse' });

  fake.recognitions[1].resolve(LAYOUT);
  await reading;
  const { scan } = session.view();
  assert.equal(scan.kind, 'review');
  assert.equal(scan.result.outcome, 'ok');
  assert.equal(
    scan.result.readings.find((r) => r.field === 'proteinPer100g').value,
    21,
  );
  assert.equal(scan.image.url, 'blob:prepared:a:0');
  assert.equal(fake.recognitions.length, 2);
  assert.deepEqual(fake.prepared, ['a']);
  assert.deepEqual(fake.shown, ['blob:prepared:a:0']);
});

test('when the sparse pass finds no per-100 column either, the first result is kept', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();
  await failFirstPass(fake);
  assert.equal(fake.recognitions.length, 2);
  fake.recognitions[1].resolve(NO_HEADER_FAT);
  await reading;
  await flush();

  const { scan } = session.view();
  assert.equal(scan.kind, 'review');
  assert.equal(scan.result.outcome, 'no-per-100-column');
  // Protein came from the first pass; fat only from the sparse one.
  assert.deepEqual(fieldsRead(scan.result), ['proteinPer100g']);
  assert.equal(fake.recognitions.length, 2);
});

test('reading a region never runs the fallback pass', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const reading = session.readRegion({
    left: 0,
    top: 0,
    width: 500,
    height: 300,
  });
  await flush();
  fake.recognitions[0].resolve(NO_HEADER);
  await reading;
  await flush();
  await flush();
  assert.equal(fake.recognitions.length, 1);
  const { scan } = session.view();
  assert.equal(scan.kind, 'review');
  assert.equal(scan.result.outcome, 'no-per-100-column');
});

test('cancel during cropping closes scanning and releases the photo', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  session.cancel();
  await flush();
  assert.equal(session.view().open, false);
  assert.equal(session.view().scan.kind, 'none');
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.equal(fake.recognitions.length, 0);
});

test('a new photo during cropping releases the first and crops the new one', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  await session.scan('b');
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  assert.deepEqual(session.view().scan, {
    kind: 'cropping',
    image: { url: 'blob:prepared:b:1', width: 1000, height: 600 },
  });
  assert.equal(fake.recognitions.length, 0);
});

test('cancel during the fallback pass discards it and releases the photo', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();
  await failFirstPass(fake);
  assert.equal(fake.recognitions.length, 2);

  session.cancel();
  await flush();
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);

  fake.recognitions[1].resolve(LAYOUT);
  await reading;
  await flush();
  assert.equal(session.view().open, false);
  assert.equal(session.view().scan.kind, 'none');
  assert.equal(fake.recognitions.length, 2);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('a new photo during the fallback pass discards it and crops the new photo', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();
  await failFirstPass(fake);
  assert.equal(fake.recognitions.length, 2);

  await session.scan('b');
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  fake.recognitions[1].resolve(LAYOUT);
  await reading;
  await flush();
  assert.deepEqual(session.view().scan, {
    kind: 'cropping',
    image: { url: 'blob:prepared:b:1', width: 1000, height: 600 },
  });
  assert.equal(fake.recognitions.length, 2);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('a photo can be cropped while the engine loads, and a region read waits for it', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await session.scan('a');
  assert.equal(session.view().engine, 'loading');
  assert.equal(session.view().scan.kind, 'cropping');
  const region = { left: 0, top: 0, width: 500, height: 300 };
  const reading = session.readRegion(region);
  await flush();
  assert.equal(session.view().scan.kind, 'recognizing');
  assert.equal(fake.recognitions.length, 0);

  fake.engines[0].load.resolve();
  await flush();
  assert.equal(fake.engines.length, 1);
  assert.equal(fake.recognitions.length, 1);
  assert.deepEqual(fake.recognitions[0].options, { layout: 'block' });
  fake.recognitions[0].resolve(LAYOUT);
  await reading;
  assert.equal(session.view().scan.kind, 'review');
});

test('a read cancelled before its first pass ends never starts the fallback', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  const reading = session.readWholePhoto();
  await flush();
  session.cancel();
  await failFirstPass(fake);
  await reading;
  await flush();
  assert.equal(fake.recognitions.length, 1);
  // No new worker is started for a stale fallback.
  assert.equal(fake.engines.length, 1);
  assert.equal(session.view().open, false);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
});

test('a read is ignored unless a photo is being cropped', async () => {
  const { fake, session } = await readySession();
  await session.readWholePhoto();
  await session.scan('a');
  const first = session.readWholePhoto();
  const again = session.readRegion({ left: 0, top: 0, width: 10, height: 10 });
  await flush();
  assert.equal(fake.recognitions.length, 1);
  assert.equal(fake.recognitions[0].options, undefined);
  fake.recognitions[0].resolve(LAYOUT);
  await Promise.all([first, again]);
  await session.readWholePhoto();
  await flush();
  assert.equal(fake.recognitions.length, 1);
  assert.equal(session.view().scan.kind, 'review');
});

test('a photo replaced while it is being shown is released', async () => {
  const fake = fakeDependencies();
  const gate = deferred();
  const show = fake.deps.showImage;
  fake.deps.showImage = async (image) => {
    const shown = await show(image);
    await gate.promise;
    return shown;
  };
  const session = sessionModule.createLabelScanSession(fake.deps);
  const first = session.scan('a');
  await flush();
  const second = session.scan('b');
  await flush();
  gate.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(fake.shown, ['blob:prepared:a:0', 'blob:prepared:b:1']);
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  assert.deepEqual(session.view().scan, {
    kind: 'cropping',
    image: { url: 'blob:prepared:b:1', width: 1000, height: 600 },
  });
});

test('dispose during cropping releases the photo once', async () => {
  const { fake, session } = await readySession();
  await session.scan('a');
  session.dispose();
  session.cancel();
  await flush();
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  assert.equal(fake.engines[0].engine.terminated, 1);
});

test('a crop given as fractions maps to the same area of a larger original', () => {
  // The crop step shows a 1500 x 2000 copy; the original is 3024 x 4032.
  const crop = { left: 0.18, top: 0.45, width: 0.43, height: 0.36 };
  assert.deepEqual(prepareModule.cropInPixels(3024, 4032, crop), {
    x: 544,
    y: 1814,
    width: 1300,
    height: 1452,
  });
  // Kept inside the photo and at least one pixel, however it is rounded.
  assert.deepEqual(
    prepareModule.cropInPixels(100, 100, {
      left: 0.99,
      top: 1,
      width: 0.5,
      height: 0,
    }),
    { x: 99, y: 99, width: 1, height: 1 },
  );
});
