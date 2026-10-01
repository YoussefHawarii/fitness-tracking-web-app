import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Barcode slot redesign: a small, centred, barcode-shaped frame instead of a
// large scan window, and a decode crop that follows it.
//
// Measured before writing these tests: in a slot-sized crop, EAN-13 bars that
// span 90% of the crop decode, but bars spanning 95-100% never do, because
// ZXing needs the blank quiet zone beside the guard bars inside the crop.
// Users fill a small slot edge to edge, so the decode region is the visible
// slot plus a horizontal quiet-zone margin, never the whole preview.
//
// Seams (agreed before writing tests):
//   K. scan-region constants — SCAN_SLOT (what the user sees) and
//      DECODE_REGION (what is decoded), both fractions of the square preview
//   L. ScannerView           — the slot is drawn exactly at SCAN_SLOT
//   M. crop + real decoder   — a barcode filling the visible slot decodes

let vite;
const load = (path) => vite.ssrLoadModule(path);
const FEATURE = '/src/features/barcode-scanner';

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
    ssr: { noExternal: ['@zxing/library'] },
  });
});

after(async () => {
  await vite.close();
});

const close = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `expected ${expected}, got ${actual}`,
  );

// ---------------------------------------------------------------- K

test('the visible slot is a centred 4:1 barcode slot, 70% wide and 17.5% tall', async () => {
  const { SCAN_SLOT } = await load(`${FEATURE}/scan-region.ts`);

  close(SCAN_SLOT.width, 0.7);
  close(SCAN_SLOT.height, 0.175);
  close(SCAN_SLOT.x, 0.15); // centred horizontally
  close(SCAN_SLOT.y, 0.4125); // centred vertically
  close(SCAN_SLOT.width / SCAN_SLOT.height, 4);
});

test('the decode region is the slot plus a quiet-zone margin on the left and right only', async () => {
  const { SCAN_SLOT, DECODE_REGION } = await load(`${FEATURE}/scan-region.ts`);

  // 12% of the slot width on each side: 0.084 of the preview.
  close(DECODE_REGION.x, 0.066);
  close(DECODE_REGION.width, 0.868);
  close(DECODE_REGION.y, SCAN_SLOT.y);
  close(DECODE_REGION.height, SCAN_SLOT.height);
  // Far smaller than the old 80% x 30% decode area.
  assert.ok(DECODE_REGION.width * DECODE_REGION.height < 0.8 * 0.3 * 0.65);
});

test('a portrait 1080p camera in a square view decodes only the slot rows', async () => {
  const { DECODE_REGION, computeScanRegion } = await load(
    `${FEATURE}/scan-region.ts`,
  );

  // 1080x1920 covering a 400x400 view shows source x 0..1080, y 420..1500.
  const region = computeScanRegion({
    videoWidth: 1080,
    videoHeight: 1920,
    viewWidth: 400,
    viewHeight: 400,
    box: DECODE_REGION,
  });

  assert.deepEqual(region, { x: 71, y: 866, width: 937, height: 189 });
});

// ---------------------------------------------------------------- L

test('the scanning view draws the slot exactly where the slot constant says', async () => {
  const { ScannerView } = await load(`${FEATURE}/ScannerView.tsx`);

  const html = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'scanning',
      torch: { available: false, on: false },
      onToggleTorch: () => {},
    }),
  );

  const slot = html.match(/<div[^>]*aria-label="Barcode scan area"[^>]*>/)?.[0];
  assert.ok(slot, 'slot element is rendered');
  assert.match(slot, /role="img"/);
  assert.match(slot, /left:15%;top:41.25%;width:70%;height:17.5%/);
});

test('the slot has four neon-green corner brackets hidden from assistive technology', async () => {
  const { ScannerView } = await load(`${FEATURE}/ScannerView.tsx`);

  const html = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'scanning',
      torch: { available: false, on: false },
      onToggleTorch: () => {},
    }),
  );

  const brackets =
    html.match(/<span[^>]*data-slot-corner="[^"]+"[^>]*>/g) ?? [];
  assert.deepEqual(
    brackets.map((tag) => tag.match(/data-slot-corner="([^"]+)"/)[1]).sort(),
    ['bottom-left', 'bottom-right', 'top-left', 'top-right'],
  );
  for (const tag of brackets) {
    assert.match(tag, /aria-hidden="true"/);
    assert.match(tag, /border-accent/);
  }
});

// ---------------------------------------------------------------- M

// GS1 element patterns (1 = bar), independent of ZXing.
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
const EAN13 = '5901234123457';

function ean13Modules(code) {
  const d = [...code].map(Number);
  let s = '101';
  for (let i = 0; i < 6; i++) s += (PARITY[d[0]][i] === 'L' ? L : G)[d[i + 1]];
  s += '01010';
  for (let i = 7; i < 13; i++) s += R[d[i]];
  return s + '101';
}

// A 1080x1080 camera frame (shown 1:1 in the square preview). The barcode's
// bars span exactly the visible slot's width; its quiet zones lie just
// outside the slot, on blank packaging. Bars are taller than the slot, as on
// a real product.
function cameraFrameWithBarcodeFillingTheSlot(slot) {
  const size = 1080;
  const modules = ean13Modules(EAN13);
  const left = slot.x * size;
  const moduleWidth = (slot.width * size) / modules.length;
  const top = (slot.y - slot.height * 0.5) * size;
  const bottom = (slot.y + slot.height * 1.5) * size;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const m = Math.floor((x + 0.5 - left) / moduleWidth);
      const bar =
        y >= top &&
        y < bottom &&
        m >= 0 &&
        m < modules.length &&
        modules[m] === '1';
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = bar ? 25 : 235;
      data[i + 3] = 255;
    }
  }
  return { data, width: size, height: size };
}

function crop(frame, region) {
  const data = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y++) {
    const from = ((region.y + y) * frame.width + region.x) * 4;
    data.set(
      frame.data.subarray(from, from + region.width * 4),
      y * region.width * 4,
    );
  }
  return { data, width: region.width, height: region.height };
}

test('a barcode filling the visible slot edge to edge decodes from the decode region', async () => {
  const { SCAN_SLOT, DECODE_REGION, computeScanRegion } = await load(
    `${FEATURE}/scan-region.ts`,
  );
  const { createRetailDecoder } = await load(`${FEATURE}/retail-decoder.ts`);
  const frame = cameraFrameWithBarcodeFillingTheSlot(SCAN_SLOT);
  const view = {
    videoWidth: 1080,
    videoHeight: 1080,
    viewWidth: 400,
    viewHeight: 400,
  };

  const decoded = createRetailDecoder().decode(
    crop(frame, computeScanRegion({ ...view, box: DECODE_REGION })),
  );
  assert.equal(decoded, EAN13);

  // Why the margin exists: the same barcode cropped to the slot alone fails.
  const slotOnly = createRetailDecoder().decode(
    crop(frame, computeScanRegion({ ...view, box: SCAN_SLOT })),
  );
  assert.equal(slotOnly, null);
});
