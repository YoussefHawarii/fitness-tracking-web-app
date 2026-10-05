import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Label-scan session seam: the scanning lifecycle driven with a fake OCR
// engine — loading and progress, load failure and retry, cancel and retake
// mid-run, stale results, one reused worker, and releasing the worker and
// the review photo. Tesseract never runs here.

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

// A fake engine factory whose loads and recognitions the test controls.
function fakeDependencies() {
  const engines = [];
  const recognitions = [];
  const shown = [];
  const released = [];
  return {
    engines,
    recognitions,
    shown,
    released,
    deps: {
      createEngine(onProgress) {
        const load = deferred();
        const engine = {
          terminated: 0,
          recognize() {
            const job = deferred();
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
      prepareImage: async (photo) => {
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
  const scanning = session.scan('a');
  await flush();
  fake.engines[0].load.reject(new Error('offline'));
  await scanning;
  assert.deepEqual(session.view().scan, {
    kind: 'error',
    message: sessionModule.ENGINE_LOAD_FAILED_MESSAGE,
  });
});

test('a scan goes recognizing → review with readings and the photo', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  const scanning = session.scan('a');
  await flush();
  assert.equal(session.view().scan.kind, 'recognizing');

  fake.recognitions[0].resolve(LAYOUT);
  await scanning;
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
  const scanning = session.scan('a');
  await flush();

  session.cancel();
  await flush();
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.equal(session.view().open, false);

  fake.recognitions[0].resolve(LAYOUT);
  await scanning;
  assert.equal(session.view().open, false);
  assert.equal(session.view().scan.kind, 'none');
  assert.deepEqual(fake.shown, []);
});

test('a retake mid-run reuses the worker, waits its turn and ignores the replaced run', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  const first = session.scan('a');
  await flush();
  const second = session.scan('b');
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
  assert.equal(session.view().scan.image.url, 'blob:prepared:b:0');
  assert.deepEqual(fake.shown, ['blob:prepared:b:0']);
});

test('a queued run cancelled while it waits never starts', async () => {
  const fake = fakeDependencies();
  const session = sessionModule.createLabelScanSession(fake.deps);
  session.open();
  await flush();
  fake.engines[0].load.resolve();
  const first = session.scan('a');
  await flush();
  const second = session.scan('b');
  await flush();
  session.cancel();
  fake.recognitions[0].resolve(LAYOUT);
  await Promise.all([first, second]);
  await flush();
  assert.equal(fake.recognitions.length, 1);
  assert.equal(session.view().open, false);
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
  const first = session.scan('a');
  await flush();
  fake.recognitions[0].resolve(LAYOUT);
  await first;

  const retake = session.scan('b');
  assert.deepEqual(fake.released, ['blob:prepared:a:0']);
  await flush();
  fake.recognitions[1].resolve(LAYOUT);
  await retake;

  session.cancel();
  assert.deepEqual(fake.released, ['blob:prepared:a:0', 'blob:prepared:b:1']);

  session.open();
  await flush();
  fake.engines[1].load.resolve();
  const third = session.scan('c');
  await flush();
  fake.recognitions[2].resolve(LAYOUT);
  await third;
  session.dispose();
  await flush();
  assert.equal(fake.released.at(-1), 'blob:prepared:c:2');
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
    const scanning = session.scan('a');
    await flush();
    fake.recognitions[0].resolve(LAYOUT);
    await scanning;
    session.cancel();
    session.dispose();
  } finally {
    Object.assign(globalThis, saved);
  }
  assert.deepEqual(touched, []);
});
