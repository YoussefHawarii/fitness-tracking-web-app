import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// The pixel steps that prepare a photographed nutrition table for
// recognition (labelCleanup.ts): straightening, erasing grid lines, evening
// out the lighting, turning a dark title bar around, and cropping a number's
// ink for its re-read. They are pure functions over {width, height, data}
// grayscale arrays, so they run here on synthetic tables without a browser.
// The photo they were measured on (a bilingual cookie label) is not
// committed; see the harness note in the pull request.

let vite;
let cleanup;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  cleanup = await vite.ssrLoadModule(
    '/src/features/label-scan/labelCleanup.ts',
  );
});

after(async () => {
  await vite.close();
});

const PAPER = 225;
const INK = 40;

function image(width, height, fill = PAPER) {
  return { width, height, data: new Uint8Array(width * height).fill(fill) };
}

function set(img, x, y, value) {
  if (x >= 0 && y >= 0 && x < img.width && y < img.height) {
    img.data[y * img.width + x] = value;
  }
}

function rect(img, x0, y0, x1, y1, value) {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) set(img, x, y, value);
  }
}

// A line `thickness` pixels thick from (x0, y0) to (x1, y1), drawn along its
// longer direction.
function line(img, x0, y0, x1, y1, thickness, value) {
  const horizontal = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const steps = horizontal ? x1 - x0 : y1 - y0;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = Math.round(x0 + (x1 - x0) * t);
    const y = Math.round(y0 + (y1 - y0) * t);
    for (let k = 0; k < thickness; k += 1) {
      if (horizontal) set(img, x, y + k, value);
      else set(img, x + k, y, value);
    }
  }
}

// Text-like ink: `count` hollow 12 × 20 glyphs with 3 px strokes, 16 px
// apart. Short strokes, never long enough to be a line.
function glyphs(img, x, y, count, value = INK) {
  for (let i = 0; i < count; i += 1) {
    const left = x + i * 16;
    rect(img, left, y, left + 12, y + 20, value);
    rect(img, left + 3, y + 3, left + 9, y + 17, PAPER);
  }
}

// A table: horizontal lines every 60 px and vertical lines every 150 px,
// all rotated by `degrees` about the image's centre (positive: lines
// descend to the right), with a word in each cell.
function table(width, height, degrees, lineValue = INK) {
  const img = image(width, height);
  const slope = Math.tan((degrees * Math.PI) / 180);
  for (let y = 30; y < height; y += 60) {
    line(
      img,
      0,
      Math.round(y - (width / 2) * slope),
      width - 1,
      Math.round(y + (width / 2) * slope),
      3,
      lineValue,
    );
  }
  for (let x = 75; x < width; x += 150) {
    line(
      img,
      Math.round(x + (height / 2) * slope),
      0,
      Math.round(x - (height / 2) * slope),
      height - 1,
      3,
      lineValue,
    );
  }
  return img;
}

function copy(img) {
  return { ...img, data: Uint8Array.from(img.data) };
}

const at = (img, x, y) => img.data[y * img.width + x];

test('the tilt of a grid is measured from its lines, in either direction', () => {
  for (const degrees of [3.5, -2, 5]) {
    const img = table(600, 420, degrees);
    const estimate = cleanup.estimateTilt(img);
    assert.ok(
      Math.abs(estimate - degrees) <= 0.5,
      `${degrees}° estimated as ${estimate}`,
    );
  }
});

test('a level table and a picture with no lines are left alone', () => {
  assert.equal(cleanup.estimateTilt(table(600, 420, 0)), 0);
  assert.equal(cleanup.estimateTilt(table(600, 420, 0.3)), 0);
  assert.equal(cleanup.estimateTilt(image(600, 420)), 0);
});

test('straightening a tilted grid makes its lines level', () => {
  const img = table(600, 420, 3.5);
  const tilt = cleanup.estimateTilt(img);
  const transform = cleanup.transformFor(600, 420, tilt, 1);
  const level = cleanup.resample(img, transform);
  assert.ok(Math.abs(cleanup.estimateTilt(level)) < 0.5);
  // The copy is a little larger than the photo, so no corner is cut off.
  assert.ok(level.width > 600 && level.height > 420);
});

test('boxes map back from the copy to the photo, and rectangles into it', () => {
  const transform = cleanup.transformFor(600, 420, -3.5, 2);
  const rectangle = { left: 100, top: 80, width: 200, height: 60 };
  const inCopy = cleanup.rectangleToCopy(rectangle, transform);
  const back = cleanup.boxToPhoto(
    {
      x0: inCopy.left,
      y0: inCopy.top,
      x1: inCopy.left + inCopy.width,
      y1: inCopy.top + inCopy.height,
    },
    transform,
  );
  // The way back holds the rectangle, with only the slack a rotated box adds.
  assert.ok(back.x0 <= 100 && back.y0 <= 80);
  assert.ok(back.x1 >= 300 && back.y1 >= 140);
  assert.ok(back.x0 >= 100 - 25 && back.x1 <= 300 + 25);
  assert.ok(back.y0 >= 80 - 25 && back.y1 <= 140 + 25);

  // With no tilt and no scaling a box maps to itself.
  const identity = cleanup.transformFor(600, 420, 0, 1);
  const box = { x0: 50, y0: 60, x1: 120, y1: 90 };
  assert.deepEqual(cleanup.boxToPhoto(box, identity), box);
});

test('grid lines are erased and text-like ink is kept', () => {
  const img = table(600, 420, 1);
  // Words in the middle of cells, and a long thin stroke shorter than any
  // line (the joined baseline of an Arabic word).
  const inks = [
    [90, 40, 5],
    [100, 100, 4],
    [385, 220, 6],
  ];
  for (const [x, y, count] of inks) glyphs(img, x, y, count);
  line(img, 390, 70, 460, 70, 4, INK);
  const before = copy(img);

  const cleaned = cleanup.removeGridLines(img);

  // Where each line passes the middle of the image it is paper now.
  const slope = Math.tan((1 * Math.PI) / 180);
  for (let y = 30; y < 420; y += 60) {
    const lineY = Math.round(y + (300 - 300) * slope);
    let darkest = 255;
    for (let k = -2; k <= 4; k += 1) {
      darkest = Math.min(darkest, at(cleaned, 300, lineY + k));
    }
    assert.ok(darkest > 150, `line near y=${y} is still there (${darkest})`);
  }
  for (let x = 75; x < 600; x += 150) {
    let darkest = 255;
    for (let k = -2; k <= 4; k += 1) {
      darkest = Math.min(darkest, at(cleaned, x + k, 45));
    }
    assert.ok(darkest > 150, `vertical line near x=${x} is still there`);
  }
  // Ink is exactly as it was.
  for (const [x, y, count] of inks) {
    for (let j = 0; j < 20; j += 1) {
      for (let i = 0; i < count * 16; i += 1) {
        assert.equal(at(cleaned, x + i, y + j), at(before, x + i, y + j));
      }
    }
  }
  assert.ok(at(cleaned, 420, 71) < 100, 'the short baseline was erased');
});

test('a picture without long lines comes back untouched', () => {
  const img = image(300, 200);
  glyphs(img, 40, 40, 6);
  assert.strictEqual(cleanup.removeGridLines(img), img);
});

test('flat-field evens out lighting but keeps ink dark', () => {
  const img = image(600, 300);
  // A shadow: paper goes from 110 on the left to 230 on the right.
  for (let y = 0; y < 300; y += 1) {
    for (let x = 0; x < 600; x += 1)
      set(img, x, y, 110 + Math.round((120 * x) / 600));
  }
  // Ink at 30% of the paper brightness around it, at both ends.
  const strokes = image(600, 300);
  glyphs(strokes, 40, 130, 5);
  glyphs(strokes, 500, 130, 5);
  for (let i = 0; i < img.data.length; i += 1) {
    if (strokes.data[i] === INK) img.data[i] = Math.round(img.data[i] * 0.3);
  }

  const flat = cleanup.flatField(img);

  const paperLeft = at(flat, 20, 20);
  const paperRight = at(flat, 580, 20);
  assert.ok(
    Math.abs(paperLeft - paperRight) < 15,
    `${paperLeft} vs ${paperRight}`,
  );
  assert.ok(paperLeft > 215);
  // Ink is as dark relative to its paper at both ends.
  assert.ok(at(flat, 41, 140) < 120);
  assert.ok(at(flat, 501, 140) < 120);
});

test('a dark title bar is turned around; thin lines, text and dark backdrops are not', () => {
  const img = image(600, 400);
  // The bar: near-black with light letters.
  rect(img, 40, 40, 560, 90, 20);
  glyphs(img, 70, 55, 8, 235);
  // A thin dark line, and a row of dark text, below it.
  line(img, 0, 150, 599, 150, 3, INK);
  glyphs(img, 70, 200, 8);
  // A dark backdrop far thicker than any bar.
  rect(img, 0, 300, 600, 400, 25);

  const out = cleanup.invertDarkBands(img);

  assert.ok(at(out, 300, 45) > 200, 'the bar is light now');
  assert.ok(at(out, 70, 55) < 60, 'its letters are dark now');
  assert.equal(at(out, 300, 151), at(img, 300, 151));
  assert.equal(at(out, 72, 200), at(img, 72, 200));
  assert.equal(at(out, 300, 350), 25);
});

test('a picture with no bar is returned as it is', () => {
  const img = table(400, 300, 0);
  glyphs(img, 30, 40, 5);
  assert.strictEqual(cleanup.invertDarkBands(img), img);
});

test('cleaning a tilted, gridded table with a dark title bar leaves ink on a plain page', () => {
  const img = table(700, 480, 3.5);
  rect(img, 60, 40, 640, 100, 20);
  glyphs(img, 90, 60, 10, 235);
  glyphs(img, 90, 170, 7);
  glyphs(img, 400, 290, 5);

  const { image: out, transform } = cleanup.cleanForRecognition(img);

  assert.ok(Math.abs(transform.tilt - 3.5) <= 0.5);
  assert.equal(out.width, transform.copy.width);
  assert.equal(out.height, transform.copy.height);
  // Almost all pixels are paper, and almost none are line-dark.
  let dark = 0;
  let paper = 0;
  for (const v of out.data) {
    if (v < 117) dark += 1;
    if (v > 200) paper += 1;
  }
  assert.ok(
    dark / out.data.length < 0.08,
    `dark share ${dark / out.data.length}`,
  );
  assert.ok(
    paper / out.data.length > 0.85,
    `paper share ${paper / out.data.length}`,
  );
  // The title bar's lettering is dark on a light bar, where the bar was.
  const bar = cleanup.rectangleToCopy(
    { left: 90, top: 60, width: 160, height: 20 },
    transform,
  );
  let barDark = 0;
  let barLight = 0;
  for (let y = bar.top; y < bar.top + bar.height; y += 1) {
    for (let x = bar.left; x < bar.left + bar.width; x += 1) {
      const v = out.data[y * out.width + x];
      if (v < 117) barDark += 1;
      else if (v > 180) barLight += 1;
    }
  }
  assert.ok(
    barDark > 0 && barLight > barDark,
    `${barDark} dark, ${barLight} light`,
  );
});

test('cleaning a large photo stays fast', () => {
  const img = table(2000, 1500, 2);
  glyphs(img, 100, 40, 12);
  const start = performance.now();
  cleanup.cleanForRecognition(img);
  // Generous: this is a guard against a runaway step, not a benchmark.
  assert.ok(performance.now() - start < 4000);
});

// -----------------------------------------------------------------------
// Number crops

// A cleaned-copy stand-in: even paper, a number's digits, a neighbouring
// label across a gap, a faint trace of an erased line, and another row's text
// just below.
function numberScene() {
  const img = image(500, 200, 235);
  glyphs(img, 200, 60, 6, 30); // the number: x 200-292, y 60-80
  glyphs(img, 20, 60, 4, 30); // a neighbour well to its left
  glyphs(img, 330, 60, 2, 30); // and a unit-like bit well to its right
  rect(img, 140, 40, 160, 120, 140); // the trace of an erased vertical line
  glyphs(img, 200, 120, 6, 30); // the row below
  return img;
}

test('a number is cropped round its own ink, not round the box or its neighbours', () => {
  const img = numberScene();
  // A page-pass box that is too tall (reaches into the next row) and too
  // narrow (misses the last digit).
  const crop = cleanup.numberInkCrop(img, {
    x0: 200,
    y0: 50,
    x1: 270,
    y1: 130,
  });

  assert.ok(crop, 'a crop was found');
  assert.ok(crop.left >= 140 + 20, 'stops short of the faint line trace');
  assert.ok(
    crop.left <= 200 && crop.left + crop.width >= 292,
    'holds every digit',
  );
  assert.ok(crop.left + crop.width < 330, 'leaves the unit-like bit out');
  assert.ok(crop.top <= 60 && crop.top + crop.height >= 80);
  assert.ok(crop.top + crop.height < 120, 'leaves the row below out');
});

test('no crop where the box holds no ink', () => {
  const img = image(200, 100, 235);
  assert.equal(
    cleanup.numberInkCrop(img, { x0: 20, y0: 20, x1: 80, y1: 50 }),
    undefined,
  );
});

test('a number crop is enlarged for its re-read: to about 65 px of height, never shrunk, never past 3x', () => {
  assert.equal(cleanup.rereadScale(40), 1.625);
  assert.equal(cleanup.rereadScale(200), 1);
  assert.equal(cleanup.rereadScale(10), 3);

  const img = image(100, 60);
  rect(img, 10, 10, 20, 20, 0);
  const crop = { left: 5, top: 5, width: 30, height: 20 };
  const big = cleanup.enlargeCrop(img, crop, 2);
  assert.equal(big.width, 60);
  assert.equal(big.height, 40);
  // The 10 × 10 square starts 5 px into the crop: 10 px in, 20 px wide.
  assert.equal(at(big, 14, 14), 0);
  assert.equal(at(big, 2, 2), PAPER);
});
