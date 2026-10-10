import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// How the on-device engine uses the cleaned copy of a photo (labelCleanup.ts):
// on a photo with a table grid every recognition reads the copy and never the
// photo itself, the copy is read as sparse text, a number is re-read from its
// own enlarged crop (cut from the copy before its grid lines were erased), and
// recognised positions come back on the photo. A photo with no grid is read
// as it is. Tesseract is the recording stand-in; the pixel codec is a stub,
// so no canvas is needed.

let vite;
let engineModule;
let cleanup;
let runner;
let fake;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
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
  cleanup = await vite.ssrLoadModule(
    '/src/features/label-scan/labelCleanup.ts',
  );
  runner = await vite.ssrLoadModule(
    '/src/features/label-scan/cleanupRunner.ts',
  );
  fake = await vite.ssrLoadModule('/test/fixtures/fake-tesseract.mjs');
});

after(async () => {
  await vite.close();
});

// A 400 × 300 photo of even paper with the two digits of "21" at (50, 5): the
// fake recogniser reports "21" at (100, 10)-(140, 30), which is where that
// ink sits in the copy, 2x larger. Three table lines run across it; the first
// at `lineY` (the default leaves a gap below the digits, a smaller one cuts
// through them). `grid: false` leaves it a plain page.
function photoPixels({ lineY = 30, grid = true } = {}) {
  const data = new Uint8Array(400 * 300).fill(235);
  if (grid) {
    for (const y of [lineY, 100, 200]) {
      data.fill(30, y * 400, (y + 3) * 400);
    }
  }
  for (let i = 0; i < 2; i += 1) {
    const left = 50 + i * 16;
    for (let y = 5; y < 25; y += 1) {
      for (let x = left; x < left + 12; x += 1) {
        const hollow = x >= left + 3 && x < left + 9 && y >= 8 && y < 22;
        if (!hollow) data[y * 400 + x] = 30;
      }
    }
  }
  return { width: 400, height: 300, data };
}

function stubCodec(photo, { failDecode = false, pixels = photoPixels } = {}) {
  const encoded = [];
  return {
    encoded,
    async decode(image) {
      assert.equal(image, photo, 'only the photo is decoded');
      if (failDecode) throw new Error('no canvas');
      return pixels();
    },
    async encode(gray) {
      const blob = new Blob([`copy ${encoded.length}`]);
      encoded.push({ gray, blob });
      return blob;
    },
  };
}

async function scan(options, codecOptions) {
  const photo = new Blob(['photo bytes'], { type: 'image/png' });
  const codec = stubCodec(photo, codecOptions);
  const saved = globalThis.createImageBitmap;
  const { width, height } = (codecOptions?.pixels ?? photoPixels)();
  globalThis.createImageBitmap = async () => ({ width, height, close() {} });
  const start = fake.calls.length;
  try {
    const engine = await engineModule.createTesseractEngine(
      () => {},
      codec,
      // The cleanup runs in this thread: tests have no Worker.
      async (photo, region) => cleanup.cleanForRecognition(photo, region),
    );
    const layout = await engine.recognize(photo, options);
    await engine.terminate();
    const recognitions = fake.calls
      .slice(start)
      .filter((c) => c.type === 'recognize');
    return {
      layout,
      photo,
      codec,
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

test('every recognition reads the cleaned copy, never the photo, and the copy is read as sparse text', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), fakeWord('21', 100, 10)]);
  try {
    const { photo, codec, pagePasses, numberRereads } = await scan({
      layout: 'block',
    });

    // One cleaned copy, 2x the photo (a small photo is enlarged), read by
    // both language passes in sparse-text mode whatever layout was asked.
    assert.equal(codec.encoded[0].gray.width, 800);
    assert.equal(codec.encoded[0].gray.height, 600);
    assert.deepEqual(
      pagePasses.map((c) => [c.language, c.pageSegMode, c.image]),
      [
        ['eng', '11', codec.encoded[0].blob],
        ['ara', '11', codec.encoded[0].blob],
      ],
    );
    for (const call of [...pagePasses, ...numberRereads]) {
      assert.notEqual(call.image, photo);
      assert.equal(call.options?.rectangle, undefined);
    }
  } finally {
    fake.setWords();
  }
});

test('a number is re-read from an enlarged crop of its own ink', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), fakeWord('21', 100, 10)]);
  try {
    const { codec, numberRereads } = await scan({ layout: 'block' });

    assert.equal(numberRereads.length, 1);
    const crop = codec.encoded[1];
    assert.equal(numberRereads[0].image, crop.blob);
    // Tight round the two digits (about 30 × 20 px of ink in the copy's
    // 2x, plus margin), enlarged to about 65 px tall — far smaller than the
    // copy, and bigger than the box it was cut from.
    assert.ok(crop.gray.width < 300 && crop.gray.height >= 50);
    assert.ok(crop.gray.height <= 100);
  } finally {
    fake.setWords();
  }
});

test('recognised words are mapped back onto the photo', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), fakeWord('21', 100, 10)]);
  try {
    const { layout } = await scan({ layout: 'block' });
    const box = (text) => layout.words.find((w) => w.text === text).bbox;
    // The copy is 2x the photo, with no tilt.
    assert.deepEqual(box('Protein'), { x0: 5, y0: 5, x1: 25, y1: 15 });
    assert.deepEqual(box('21'), { x0: 50, y0: 5, x1: 70, y1: 15 });
  } finally {
    fake.setWords();
  }
});

test('a region on the photo is read as that region of the copy', async () => {
  const { pagePasses } = await scan({
    region: { left: 100, top: 50, width: 200, height: 100 },
  });
  for (const pass of pagePasses) {
    assert.deepEqual(pass.options.rectangle, {
      left: 200,
      top: 100,
      width: 400,
      height: 200,
    });
  }
});

test('when the photo cannot be decoded, it is read as it is', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), fakeWord('21', 100, 10)]);
  try {
    const { photo, codec, pagePasses, numberRereads, layout } = await scan(
      { layout: 'block' },
      { failDecode: true },
    );
    assert.equal(codec.encoded.length, 0);
    // Block mode, as before, and the photo itself for every recognition.
    assert.deepEqual(
      pagePasses.map((c) => c.pageSegMode),
      ['6', '6'],
    );
    for (const call of [...pagePasses, ...numberRereads]) {
      assert.equal(call.image, photo);
    }
    assert.deepEqual(layout.words.find((w) => w.text === '21').bbox, {
      x0: 100,
      y0: 10,
      x1: 140,
      y1: 30,
    });
  } finally {
    fake.setWords();
  }
});

test('a photo with no table grid is read as it is, in the page mode asked for', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), fakeWord('21', 100, 10)]);
  try {
    const { photo, codec, pagePasses, numberRereads, layout } = await scan(
      { layout: 'block' },
      { pixels: () => photoPixels({ grid: false }) },
    );
    // No cleaned copy is encoded or read, and the layout asked for is used.
    assert.equal(codec.encoded.length, 0);
    assert.deepEqual(
      pagePasses.map((c) => c.pageSegMode),
      ['6', '6'],
    );
    for (const call of [...pagePasses, ...numberRereads]) {
      assert.equal(call.image, photo);
    }
    assert.equal(layout.sparse, false);
    // Positions are the photo's own, and carry no copy box.
    const word = layout.words.find((w) => w.text === '21');
    assert.deepEqual(word.bbox, { x0: 100, y0: 10, x1: 140, y1: 30 });
    assert.equal(word.layoutBox, undefined);
  } finally {
    fake.setWords();
  }
});

test('a gridded photo with no layout asked for is read as sparse text and says so', async () => {
  const { pagePasses, layout } = await scan();
  assert.deepEqual(
    pagePasses.map((c) => c.pageSegMode),
    ['11', '11'],
  );
  assert.equal(layout.sparse, true);
  // Each word carries where it sat in the copy (2x the photo) for the reader.
  const word = layout.words.find((w) => w.text === '21');
  assert.deepEqual(word.layoutBox, { x0: 100, y0: 10, x1: 140, y1: 30 });
  assert.deepEqual(word.bbox, { x0: 50, y0: 5, x1: 70, y1: 15 });
});

test('a photo with no grid and no layout keeps automatic page mode', async () => {
  const { pagePasses, layout } = await scan(undefined, {
    pixels: () => photoPixels({ grid: false }),
  });
  assert.deepEqual(
    pagePasses.map((c) => c.pageSegMode),
    ['3', '3'],
  );
  assert.equal(layout.sparse, false);
});

// "21" boxed over the whole height of its two digits in the copy.
const wholeDigits = {
  text: '21',
  confidence: 95,
  bbox: { x0: 100, y0: 10, x1: 164, y1: 50 },
};

test('the second reading is cut from the copy before its grid lines were erased', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), wholeDigits]);
  try {
    // A table line runs just below the digits (copy rows 60-66), outside
    // their ink but inside the margin of the re-read crop.
    const { codec, numberRereads } = await scan({ layout: 'block' });
    assert.equal(numberRereads.length, 1);
    const copyBlob = codec.encoded[0].gray;
    const cropGray = codec.encoded[1].gray;
    const darkest = (img, y0, y1) => {
      let min = 255;
      for (let y = y0; y < y1; y += 1) {
        for (let x = 0; x < img.width; x += 1) {
          min = Math.min(min, img.data[y * img.width + x]);
        }
      }
      return min;
    };
    // The line is gone from the copy the page passes read (below the digits
    // at 10-50, between 56 and 70)...
    assert.ok(darkest(copyBlob, 56, 70) > 117);
    // ...and still in the crop the re-read sees, in its bottom rows.
    assert.ok(darkest(cropGray, cropGray.height - 4, cropGray.height) < 120);
  } finally {
    fake.setWords();
  }
});

test('a number whose ink the grid-line erasure touched is not verified, even when both readings agree', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), wholeDigits]);
  try {
    // The first table line cuts through the digits.
    const { layout, numberRereads } = await scan(
      { layout: 'block' },
      { pixels: () => photoPixels({ lineY: 12 }) },
    );
    const word = layout.words.find((w) => w.text === '21');
    assert.equal(word.numberCheck, 'unverified');
    // It was not even re-read: two readings of one cut digit prove nothing.
    assert.equal(numberRereads.length, 0);
  } finally {
    fake.setWords();
  }
});

test('a digit the page pass got wrong is not verified when the re-read disagrees', async () => {
  // "415.033" for a printed 415.932: within the energy check's 10 kcal of the
  // kJ figure, so only the second reading can refuse it.
  fake.setWords([fakeWord('415.033', 100, 10)]);
  fake.setRereadText('415.932');
  try {
    const { layout } = await scan({ layout: 'block' });
    assert.equal(
      layout.words.find((w) => w.text === '415.033').numberCheck,
      'unverified',
    );
    fake.setRereadText('415.033');
    const agreed = await scan({ layout: 'block' });
    assert.equal(
      agreed.layout.words.find((w) => w.text === '415.033').numberCheck,
      'verified',
    );
  } finally {
    fake.setWords();
    fake.setRereadText();
  }
});

// A 600 × 420 photo whose seven table lines are tilted 3.5 degrees, and the
// copy transform the engine makes of a region of it.
function tiltedPixels() {
  const width = 600;
  const height = 420;
  const data = new Uint8Array(width * height).fill(235);
  const slope = Math.tan((3.5 * Math.PI) / 180);
  for (let line = 0; line < 7; line += 1) {
    for (let x = 0; x < width; x += 1) {
      const y = Math.round(30 + line * 60 + (x - width / 2) * slope);
      for (let k = 0; k < 3; k += 1) {
        if (y + k >= 0 && y + k < height) data[(y + k) * width + x] = 30;
      }
    }
  }
  return { width, height, data };
}

test('a region of a tilted photo keeps only the words whose centre is inside it', async () => {
  const region = { left: 150, top: 120, width: 300, height: 180 };
  const { transform } = cleanup.cleanForRecognition(tiltedPixels(), region);
  assert.ok(Math.abs(transform.tilt - 3.5) <= 0.6);
  // The region maps to a wider rectangle of the copy; its top-left corner is
  // outside the region on the photo, its middle inside.
  const rect = cleanup.rectangleToCopy(region, transform);
  const at = (u, v) => ({ x0: u, y0: v, x1: u + 40, y1: v + 20 });
  const corner = at(rect.left, rect.top);
  const middle = at(
    rect.left + rect.width / 2 - 20,
    rect.top + rect.height / 2 - 10,
  );
  const photoCentre = (box) => {
    const b = cleanup.boxToPhoto(box, transform);
    return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  };
  const inside = ([x, y]) =>
    x >= region.left &&
    x <= region.left + region.width &&
    y >= region.top &&
    y <= region.top + region.height;
  assert.equal(inside(photoCentre(corner)), false, 'the corner is outside');
  assert.equal(inside(photoCentre(middle)), true, 'the middle is inside');

  const words = (text, box) => ({ text, confidence: 95, bbox: box });
  fake.setWords([words('Corner', corner), words('Middle', middle)]);
  try {
    const { layout, pagePasses } = await scan(
      { region },
      { pixels: tiltedPixels },
    );
    // Tesseract is still given the (wider) rectangle of the copy...
    assert.deepEqual(pagePasses[0].options.rectangle, rect);
    // ...and the word outside the user's region is dropped.
    assert.deepEqual(
      layout.words.map((w) => w.text),
      ['Middle'],
    );
  } finally {
    fake.setWords();
  }
});

test('the region on an untilted gridded photo drops words outside it as well', async () => {
  fake.setWords([fakeWord('Protein', 10, 10), fakeWord('21', 100, 10)]);
  try {
    // The copy is 2x: "Protein" sits at (5, 5) on the photo, "21" at (50, 5).
    const { layout } = await scan({
      region: { left: 0, top: 0, width: 40, height: 40 },
    });
    assert.deepEqual(
      layout.words.map((w) => w.text),
      ['Protein'],
    );
  } finally {
    fake.setWords();
  }
});

test('a worker that died after taking the photo is retried on the main thread from a fresh decode', async () => {
  const photo = new Blob(['photo bytes'], { type: 'image/png' });
  const codec = stubCodec(photo);
  let decodes = 0;
  const decode = codec.decode;
  codec.decode = async (image) => {
    decodes += 1;
    return decode(image);
  };
  const saved = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({
    width: 400,
    height: 300,
    close() {},
  });
  const start = fake.calls.length;
  try {
    const engine = await engineModule.createTesseractEngine(
      () => {},
      codec,
      async () => {
        throw new runner.CleanupWorkerDied();
      },
    );
    const layout = await engine.recognize(photo, { layout: 'block' });
    await engine.terminate();
    assert.equal(decodes, 2);
    assert.equal(layout.sparse, true);
    const passes = fake.calls
      .slice(start)
      .filter((c) => c.type === 'recognize' && c.pageSegMode === '11');
    assert.equal(passes.length, 2);
    assert.equal(passes[0].image, codec.encoded[0].blob);
  } finally {
    globalThis.createImageBitmap = saved;
  }
});

// Runs `recognize` once per entry of `calls` on one engine and one photo, with a
// counting cleaner, and returns how often the photo was decoded and cleaned.
async function readTwice(codecOptions, calls, cleaner) {
  const photo = new Blob(['photo bytes'], { type: 'image/png' });
  const codec = stubCodec(photo, codecOptions);
  let decodes = 0;
  const decode = codec.decode;
  codec.decode = async (image) => {
    decodes += 1;
    return decode(image);
  };
  let cleans = 0;
  const saved = globalThis.createImageBitmap;
  const { width, height } = (codecOptions?.pixels ?? photoPixels)();
  globalThis.createImageBitmap = async () => ({ width, height, close() {} });
  try {
    const engine = await engineModule.createTesseractEngine(
      () => {},
      codec,
      cleaner
        ? cleaner
        : async (pixels, region) => {
            cleans += 1;
            return cleanup.cleanForRecognition(pixels, region);
          },
    );
    const layouts = [];
    for (const options of calls) {
      layouts.push(await engine.recognize(photo, options));
    }
    await engine.terminate();
    return { decodes, cleans, layouts, codec };
  } finally {
    globalThis.createImageBitmap = saved;
  }
}

test('a second pass over the same photo reuses the cleaned copy', async () => {
  const twice = await readTwice(undefined, [
    { layout: 'block' },
    { layout: 'sparse' },
  ]);
  assert.equal(twice.decodes, 1);
  assert.equal(twice.cleans, 1);
  // The copy was encoded once as well: both passes read the same Blob.
  assert.equal(twice.layouts.length, 2);
});

test('a gridless photo is decoded and cleaned once across the fallback pass too', async () => {
  const twice = await readTwice(
    { pixels: () => photoPixels({ grid: false }) },
    [{ layout: 'block' }, { layout: 'sparse' }],
  );
  assert.equal(twice.decodes, 1);
  assert.equal(twice.cleans, 1);
  assert.equal(twice.codec.encoded.length, 0);
});

// "11" right-aligned beside a vertical border: its second stem lies in the
// border's columns and the erasure removes it completely, leaving a "1".
function cutElevenPixels() {
  const width = 400;
  const height = 300;
  const data = new Uint8Array(width * height).fill(235);
  for (const y of [100, 160, 220]) data.fill(30, y * width, (y + 3) * width);
  for (let y = 0; y < height; y += 1)
    data.fill(30, y * width + 69, y * width + 72);
  for (let y = 5; y < 25; y += 1) data.fill(30, y * width + 60, y * width + 63);
  return { width, height, data };
}

test('a number cut to its first stem by a border beside it is not verified, though both readings say "1"', async () => {
  fake.setWords([
    { text: '1', confidence: 95, bbox: { x0: 118, y0: 10, x1: 130, y1: 50 } },
  ]);
  fake.setRereadText('1');
  try {
    const { layout } = await scan(
      { layout: 'block' },
      { pixels: cutElevenPixels },
    );
    assert.equal(layout.words[0].numberCheck, 'unverified');
  } finally {
    fake.setWords();
    fake.setRereadText();
  }
});

test('terminating the engine aborts a cleanup still running', async () => {
  const photo = new Blob(['photo bytes'], { type: 'image/png' });
  const codec = stubCodec(photo);
  const saved = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({
    width: 400,
    height: 300,
    close() {},
  });
  try {
    let signal;
    let started;
    const running = new Promise((resolve) => (started = resolve));
    const engine = await engineModule.createTesseractEngine(
      () => {},
      codec,
      (pixels, region, abort) => {
        signal = abort;
        started();
        return new Promise(() => {});
      },
    );
    engine.recognize(photo, { layout: 'block' }).catch(() => {});
    await running;
    assert.equal(signal.aborted, false);
    await engine.terminate();
    assert.equal(signal.aborted, true);
  } finally {
    globalThis.createImageBitmap = saved;
  }
});

test('a failed cleanup is not remembered, so the next pass tries again', async () => {
  let calls = 0;
  const twice = await readTwice(
    undefined,
    [{ layout: 'block' }, { layout: 'sparse' }],
    async (pixels, region) => {
      calls += 1;
      if (calls === 1) throw new Error('cleanup failed');
      return cleanup.cleanForRecognition(pixels, region);
    },
  );
  assert.equal(calls, 2);
  assert.equal(twice.layouts[0].sparse, false);
  assert.equal(twice.layouts[1].sparse, true);
});

test('only the most recent region of a photo keeps its cleaned copy', async () => {
  let cleans = 0;
  const regionA = { left: 0, top: 0, width: 200, height: 150 };
  const regionB = { left: 100, top: 100, width: 200, height: 150 };
  await readTwice(
    undefined,
    [
      { region: regionA },
      { region: regionA },
      { region: regionB },
      { region: regionA },
    ],
    async (pixels, region) => {
      cleans += 1;
      return cleanup.cleanForRecognition(pixels, region);
    },
  );
  // A, A (kept), B (replaces A), A again (cleaned anew).
  assert.equal(cleans, 3);
});

test('a worker that died after the engine was stopped is not retried on the main thread', async () => {
  const photo = new Blob(['photo bytes'], { type: 'image/png' });
  const codec = stubCodec(photo);
  let decodes = 0;
  const decode = codec.decode;
  codec.decode = async (image) => {
    decodes += 1;
    return decode(image);
  };
  const saved = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({
    width: 400,
    height: 300,
    close() {},
  });
  try {
    let engine;
    engine = await engineModule.createTesseractEngine(
      () => {},
      codec,
      async () => {
        await engine.terminate();
        throw new runner.CleanupWorkerDied();
      },
    );
    await engine.recognize(photo, { layout: 'block' }).catch(() => {});
    assert.equal(decodes, 1);
  } finally {
    globalThis.createImageBitmap = saved;
  }
});
