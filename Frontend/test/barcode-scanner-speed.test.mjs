import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'vite';

// Scanner speed work. Diagnosis (synthetic EAN-13 frames at the real crop
// size, real ZXing, simulated handheld camera): a frame without a barcode
// cost ~20 ms because ZXing throws ~350 exceptions per miss and each captured
// a stack trace; the loop slept a fixed 120 ms after every decode; and two
// matching reads were required. Together: p90 ~4.5 s to confirm a visible
// barcode when only some handheld frames are sharp.
//
// Seams (agreed before writing tests):
//   E. retail-decoder  — ZXing restricted to EAN-13/EAN-8/UPC-A/UPC-E, over RGBA pixels
//   F. native-detector — validation + feature detection for the browser BarcodeDetector
//   G. frame-decoder   — native first, permanent fallback to ZXing
//   H. frame-loop      — decode paced by new camera frames, one in flight, stoppable
//   I. scan-session    — single-read confirmation, single emission (see barcode-scanner.test.mjs)
//   J. cropper         — crop canvas reused, resized only when the crop changes

let vite;
const load = (path) => vite.ssrLoadModule(path);
const FEATURE = '/src/features/barcode-scanner';

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
    ssr: { noExternal: ['@zxing/browser', '@zxing/library'] },
  });
});

after(async () => {
  await vite.close();
});

// --------------------------------------------------- synthetic camera frames

// GS1 element patterns (1 = bar). Independent of ZXing: these are the
// published EAN/UPC encoding tables.
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];
const R = L.map((code) =>
  [...code].map((bit) => (bit === '0' ? '1' : '0')).join(''),
);
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

function ean13Modules(code) {
  const d = [...code].map(Number);
  let s = '101';
  for (let i = 0; i < 6; i++) s += (PARITY[d[0]][i] === 'L' ? L : G)[d[i + 1]];
  s += '01010';
  for (let i = 7; i < 13; i++) s += R[d[i]];
  return s + '101';
}

function ean8Modules(code) {
  const d = [...code].map(Number);
  let s = '101';
  for (let i = 0; i < 4; i++) s += L[d[i]];
  s += '01010';
  for (let i = 4; i < 8; i++) s += R[d[i]];
  return s + '101';
}

// An RGBA frame shaped like the crop the scanner hands to the decoder
// (864x324 from a 1080p camera). `blur` is a horizontal box blur radius in
// pixels, standing in for defocus or hand shake.
function frame({
  modules = null,
  width = 864,
  height = 324,
  fill = 0.5,
  blur = 0,
} = {}) {
  let row = new Float32Array(width).fill(235);
  if (modules) {
    const total = modules.length + 18; // 9-module quiet zone each side
    const moduleWidth = (width * fill) / total;
    const x0 = (width - width * fill) / 2 + 9 * moduleWidth;
    for (let x = 0; x < width; x++) {
      const m = Math.floor((x + 0.5 - x0) / moduleWidth);
      if (m >= 0 && m < modules.length && modules[m] === '1') row[x] = 25;
    }
  }
  if (blur > 0) {
    const out = new Float32Array(width);
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let n = 0;
      for (let k = -blur; k <= blur; k++) {
        if (x + k >= 0 && x + k < width) {
          sum += row[x + k];
          n++;
        }
      }
      out[x] = sum / n;
    }
    row = out;
  }
  const top = Math.round(height * 0.2);
  const bottom = height - top;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = modules && y >= top && y < bottom ? row[x] : 235;
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

const EAN13 = '5901234123457';
const EAN8 = '96385074';
const UPCA_AS_EAN13 = '0036000291452';

// ---------------------------------------------------------------- E

test('the decoder reads EAN-13 and EAN-8 from a camera-sized crop', async () => {
  const { createRetailDecoder } = await load(`${FEATURE}/retail-decoder.ts`);
  const decoder = createRetailDecoder();

  assert.equal(decoder.decode(frame({ modules: ean13Modules(EAN13) })), EAN13);
  assert.equal(decoder.decode(frame({ modules: ean8Modules(EAN8) })), EAN8);
});

test('a UPC-A barcode is still reported as its 12 digits, as before', async () => {
  const { createRetailDecoder } = await load(`${FEATURE}/retail-decoder.ts`);
  const decoder = createRetailDecoder();

  assert.equal(
    decoder.decode(frame({ modules: ean13Modules(UPCA_AS_EAN13) })),
    '036000291452',
  );
});

test('frames without a readable barcode return null quietly, without console noise', async () => {
  const { createRetailDecoder } = await load(`${FEATURE}/retail-decoder.ts`);
  const decoder = createRetailDecoder();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    assert.equal(decoder.decode(frame()), null);
    assert.equal(
      decoder.decode(frame({ modules: ean13Modules(EAN13), blur: 4 })),
      null,
    );
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 0);
});

test('decoding leaves the global stack trace limit exactly as it found it', async () => {
  const { createRetailDecoder } = await load(`${FEATURE}/retail-decoder.ts`);
  const decoder = createRetailDecoder();
  const original = Error.stackTraceLimit;
  Error.stackTraceLimit = 17;
  try {
    decoder.decode(frame());
    assert.equal(Error.stackTraceLimit, 17);
    decoder.decode(frame({ modules: ean13Modules(EAN13) }));
    assert.equal(Error.stackTraceLimit, 17);
  } finally {
    Error.stackTraceLimit = original;
  }
});

test('an empty frame is cheap to reject (budget for decoding every camera frame)', async () => {
  // Before the fix a miss cost ~20 ms on a desktop, i.e. ~80 ms on a phone:
  // more than two camera frames. The 12 ms budget leaves over 2x headroom
  // over the ~5 ms measured with stack capture disabled.
  const { createRetailDecoder } = await load(`${FEATURE}/retail-decoder.ts`);
  const decoder = createRetailDecoder();
  const empty = frame();
  for (let i = 0; i < 5; i++) decoder.decode(empty);
  const runs = 30;
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) decoder.decode(empty);
  const perFrame = (performance.now() - t0) / runs;
  assert.ok(perFrame < 12, `miss took ${perFrame.toFixed(2)} ms per frame`);
});

// ---------------------------------------------------------------- F

test('native results are accepted only as check-digit-valid retail barcodes', async () => {
  const { acceptRetailBarcode } = await load(`${FEATURE}/native-detector.ts`);

  assert.equal(acceptRetailBarcode('ean_13', EAN13), EAN13);
  assert.equal(acceptRetailBarcode('ean_8', EAN8), EAN8);
  assert.equal(acceptRetailBarcode('upc_a', '036000291452'), '036000291452');
  // UPC-E 0-123456-5 expands to UPC-A 0-12345-00006-5 (GS1 table, digit 6 rule).
  assert.equal(acceptRetailBarcode('upc_e', '01234565'), '01234565');

  assert.equal(acceptRetailBarcode('ean_13', '5901234123458'), null); // wrong check digit
  assert.equal(acceptRetailBarcode('upc_e', '01234564'), null);
  assert.equal(acceptRetailBarcode('ean_13', '59012341234'), null); // wrong length
  assert.equal(acceptRetailBarcode('ean_13', '590123412345A'), null);
  assert.equal(acceptRetailBarcode('code_128', EAN13), null); // backend rejects non-retail
  assert.equal(acceptRetailBarcode('qr_code', 'https://example.com'), null);
});

function fakeBarcodeDetector({
  supported = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code'],
  results = [],
  rejectWith = null,
} = {}) {
  const calls = { constructed: [], detect: 0 };
  class FakeBarcodeDetector {
    constructor(options) {
      calls.constructed.push(options);
    }
    static async getSupportedFormats() {
      return supported;
    }
    async detect() {
      calls.detect += 1;
      if (rejectWith) throw rejectWith;
      return results.shift() ?? [];
    }
  }
  return { FakeBarcodeDetector, calls };
}

test('no native detector where the browser lacks BarcodeDetector or EAN-13 support', async () => {
  const { createNativeDetector } = await load(`${FEATURE}/native-detector.ts`);

  assert.equal(await createNativeDetector(undefined), null); // iOS Safari today
  const { FakeBarcodeDetector } = fakeBarcodeDetector({
    supported: ['qr_code'],
  });
  assert.equal(await createNativeDetector(FakeBarcodeDetector), null);
});

test('the native detector asks only for the retail formats the browser supports', async () => {
  const { createNativeDetector } = await load(`${FEATURE}/native-detector.ts`);
  const { FakeBarcodeDetector, calls } = fakeBarcodeDetector({
    supported: ['ean_13', 'upc_a', 'qr_code', 'code_128'],
  });

  assert.notEqual(await createNativeDetector(FakeBarcodeDetector), null);
  assert.deepEqual([...calls.constructed[0].formats].sort(), [
    'ean_13',
    'upc_a',
  ]);
});

test('the native detector returns the first valid retail result and skips invalid ones', async () => {
  const { createNativeDetector } = await load(`${FEATURE}/native-detector.ts`);
  const { FakeBarcodeDetector } = fakeBarcodeDetector({
    results: [
      [],
      [
        { format: 'ean_13', rawValue: '5901234123458' },
        { format: 'ean_13', rawValue: EAN13 },
      ],
    ],
  });
  const detector = await createNativeDetector(FakeBarcodeDetector);

  assert.equal(await detector.detect({}), null);
  assert.equal(await detector.detect({}), EAN13);
});

// ---------------------------------------------------------------- G

test('frames go to the native detector when there is one, and ZXing is skipped', async () => {
  const { createFrameDecoder } = await load(`${FEATURE}/frame-decoder.ts`);
  let zxingCalls = 0;
  const decode = createFrameDecoder({
    native: { detect: async () => EAN13 },
    zxing: { decode: () => (zxingCalls++, null) },
  });

  assert.equal(await decode({ source: {}, pixels: () => frame() }), EAN13);
  assert.equal(zxingCalls, 0);
});

test('without a native detector, ZXing decodes the crop pixels', async () => {
  const { createFrameDecoder } = await load(`${FEATURE}/frame-decoder.ts`);
  const { createRetailDecoder } = await load(`${FEATURE}/retail-decoder.ts`);
  const decode = createFrameDecoder({
    native: null,
    zxing: createRetailDecoder(),
  });

  assert.equal(
    await decode({
      source: {},
      pixels: () => frame({ modules: ean13Modules(EAN13) }),
    }),
    EAN13,
  );
});

test('a native detector that fails once is abandoned for ZXing from then on', async () => {
  const { createFrameDecoder } = await load(`${FEATURE}/frame-decoder.ts`);
  let nativeCalls = 0;
  let zxingCalls = 0;
  const decode = createFrameDecoder({
    native: {
      detect: async () => {
        nativeCalls += 1;
        throw new DOMException('Detector unavailable', 'NotSupportedError');
      },
    },
    zxing: { decode: () => (zxingCalls++, EAN13) },
  });

  assert.equal(await decode({ source: {}, pixels: () => frame() }), EAN13);
  assert.equal(await decode({ source: {}, pixels: () => frame() }), EAN13);
  assert.equal(nativeCalls, 1);
  assert.equal(zxingCalls, 2);
});

// ---------------------------------------------------------------- H

// A video element at the browser boundary. Tests push camera frames by hand.
function fakeVideo({ videoFrameCallback = true } = {}) {
  const pending = new Map();
  let nextId = 1;
  const video = { currentTime: 0 };
  if (videoFrameCallback) {
    video.requestVideoFrameCallback = (callback) => {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    };
    video.cancelVideoFrameCallback = (id) => pending.delete(id);
  }
  return {
    video,
    pendingCount: () => pending.size,
    // The camera presents a new frame.
    present() {
      video.currentTime += 1 / 30;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(performance.now(), {}));
    },
  };
}

function fakeAnimationFrames() {
  const pending = new Map();
  let nextId = 1;
  return {
    requestAnimationFrame: (callback) => {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => pending.delete(id),
    pendingCount: () => pending.size,
    tick() {
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback(performance.now()));
    },
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('every new camera frame is offered for decoding, with no fixed delay', async () => {
  const { createFrameLoop } = await load(`${FEATURE}/frame-loop.ts`);
  const camera = fakeVideo();
  const raf = fakeAnimationFrames();
  let frames = 0;
  const loop = createFrameLoop({
    video: camera.video,
    ...raf,
    onFrame: () => void frames++,
  });

  loop.start();
  for (let i = 0; i < 5; i++) {
    camera.present();
    await flush();
  }

  assert.equal(frames, 5);
  assert.equal(raf.pendingCount(), 0); // paced by the camera, not the display
});

test('a frame arriving while a decode is still running is skipped, not queued', async () => {
  const { createFrameLoop } = await load(`${FEATURE}/frame-loop.ts`);
  const camera = fakeVideo();
  let started = 0;
  let finish;
  const loop = createFrameLoop({
    video: camera.video,
    ...fakeAnimationFrames(),
    onFrame: () => {
      started += 1;
      return new Promise((resolve) => (finish = resolve));
    },
  });

  loop.start();
  camera.present();
  await flush();
  camera.present();
  camera.present();
  await flush();
  assert.equal(started, 1);

  finish();
  await flush();
  camera.present();
  await flush();
  assert.equal(started, 2);
});

test('without requestVideoFrameCallback, animation frames drive the loop but a frame is decoded once', async () => {
  const { createFrameLoop } = await load(`${FEATURE}/frame-loop.ts`);
  const camera = fakeVideo({ videoFrameCallback: false });
  const raf = fakeAnimationFrames();
  let frames = 0;
  const loop = createFrameLoop({
    video: camera.video,
    ...raf,
    onFrame: () => void frames++,
  });

  loop.start();
  raf.tick(); // display refresh, camera frame 0
  await flush();
  raf.tick(); // display refresh again, same camera frame
  await flush();
  camera.video.currentTime += 1 / 30; // camera presents a new frame
  raf.tick();
  await flush();

  assert.equal(frames, 2);
});

test('stopping cancels the pending frame and ignores a decode that finishes afterwards', async () => {
  const { createFrameLoop } = await load(`${FEATURE}/frame-loop.ts`);
  const camera = fakeVideo();
  let started = 0;
  let finish;
  const loop = createFrameLoop({
    video: camera.video,
    ...fakeAnimationFrames(),
    onFrame: () => {
      started += 1;
      return new Promise((resolve) => (finish = resolve));
    },
  });

  loop.start();
  camera.present();
  await flush();
  loop.stop();
  finish(); // the in-flight decode settles after stop
  await flush();
  camera.present();
  await flush();

  assert.equal(started, 1);
  assert.equal(camera.pendingCount(), 0);
});

test('a decode failure stops the loop and is reported once', async () => {
  const { createFrameLoop } = await load(`${FEATURE}/frame-loop.ts`);
  const camera = fakeVideo();
  const errors = [];
  let started = 0;
  const loop = createFrameLoop({
    video: camera.video,
    ...fakeAnimationFrames(),
    onFrame: () => {
      started += 1;
      throw new Error('canvas lost');
    },
    onError: (error) => errors.push(error.message),
  });

  loop.start();
  camera.present();
  await flush();
  camera.present();
  await flush();

  assert.deepEqual(errors, ['canvas lost']);
  assert.equal(started, 1);
});

// ---------------------------------------------------------------- I

function fakeCamera() {
  return {
    async openCamera() {
      return {
        capabilities: {},
        async applyZoom() {},
        async setTorch() {},
        stop() {},
      };
    },
  };
}

test('one valid read confirms the barcode at once and triggers a single lookup', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const lookups = [];
  const session = createScanSession({
    openCamera: fakeCamera().openCamera,
    onBarcode: (code) => lookups.push(code),
  });

  await session.start();
  session.reportDecode(null);
  session.reportDecode(EAN13);

  assert.equal(session.getState().status, 'decoded');
  assert.equal(session.getState().barcode, EAN13);
  // Frames already in flight keep reporting the same or another code.
  session.reportDecode(EAN13);
  session.reportDecode(EAN8);
  assert.deepEqual(lookups, [EAN13]);
});

// ---------------------------------------------------------------- J

function fakeCanvasFactory() {
  const resizes = [];
  const draws = [];
  const canvas = {
    _w: 300,
    _h: 150,
    get width() {
      return this._w;
    },
    set width(value) {
      resizes.push(['width', value]);
      this._w = value;
    },
    get height() {
      return this._h;
    },
    set height(value) {
      resizes.push(['height', value]);
      this._h = value;
    },
    getContext: () => ({
      drawImage: (...args) => draws.push(args),
      getImageData: (x, y, w, h) => ({
        data: new Uint8ClampedArray(w * h * 4),
        width: w,
        height: h,
      }),
    }),
  };
  return { createCanvas: () => canvas, canvas, resizes, draws };
}

test('the crop canvas is resized only when the crop size changes', async () => {
  const { createCropper } = await load(`${FEATURE}/cropper.ts`);
  const factory = fakeCanvasFactory();
  const cropper = createCropper(factory.createCanvas);
  const video = {};
  const region = { x: 108, y: 798, width: 864, height: 324 };

  cropper.draw(video, region);
  cropper.draw(video, region);
  cropper.draw(video, region);
  assert.deepEqual(factory.resizes, [
    ['width', 864],
    ['height', 324],
  ]);
  assert.equal(factory.draws.length, 3);
  assert.deepEqual(factory.draws[0], [
    video,
    108,
    798,
    864,
    324,
    0,
    0,
    864,
    324,
  ]);

  cropper.draw(video, { x: 0, y: 0, width: 640, height: 240 });
  assert.equal(factory.resizes.length, 4);
  assert.deepEqual(cropper.pixels(), {
    data: new Uint8ClampedArray(640 * 240 * 4),
    width: 640,
    height: 240,
  });
});

test('a missing 2D context fails from draw, after cropper creation', async () => {
  const { createCropper } = await load(`${FEATURE}/cropper.ts`);
  let contextCalls = 0;
  const cropper = createCropper(() => ({
    width: 300,
    height: 150,
    getContext: () => {
      contextCalls += 1;
      return null;
    },
  }));

  assert.equal(contextCalls, 0);
  assert.throws(
    () => cropper.draw({}, { x: 0, y: 0, width: 100, height: 40 }),
    Error,
  );
});
