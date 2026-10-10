import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// How the on-device engine uses the cleaned copy of a photo (labelCleanup.ts):
// every recognition reads the copy and never the photo itself, the copy is
// read as sparse text, a number is re-read from its own enlarged crop, and
// recognised positions come back on the photo. Tesseract is the recording
// stand-in; the pixel codec is a stub, so no canvas is needed.

let vite;
let engineModule;
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
  fake = await vite.ssrLoadModule('/test/fixtures/fake-tesseract.mjs');
});

after(async () => {
  await vite.close();
});

// A 400 × 300 photo of even paper with the two digits of "21" at (50, 5): the
// fake recogniser reports "21" at (100, 10)-(140, 30), which is where that
// ink sits in the copy, 2x larger.
function photoPixels() {
  const data = new Uint8Array(400 * 300).fill(235);
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

function stubCodec(photo, { failDecode = false } = {}) {
  const encoded = [];
  return {
    encoded,
    async decode(image) {
      assert.equal(image, photo, 'only the photo is decoded');
      if (failDecode) throw new Error('no canvas');
      return photoPixels();
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
  globalThis.createImageBitmap = async () => ({
    width: 400,
    height: 300,
    close() {},
  });
  const start = fake.calls.length;
  try {
    const engine = await engineModule.createTesseractEngine(() => {}, codec);
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
