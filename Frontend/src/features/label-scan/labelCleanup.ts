import type { BBox } from './ocrLayout';

// Preparing the pixels of a photographed nutrition table for recognition.
//
// Measured on a real bilingual label (grid lines round every cell, a white-
// on-dark title bar, glossy foil, a few degrees of tilt), Tesseract read 3 to
// 7 of 10 row labels and almost no values from the photo as taken, and no
// better from a binarised or upscaled copy. What worked was taking the
// table's own drawing out of the picture: straightening it, erasing the
// grid lines, and evening out the lighting. On that label the same engine
// then read every row label and most values.
//
// Everything here is a pure function over a grayscale pixel array, so it is
// tested in Node without a browser; the canvas that supplies and receives
// the pixels is a thin layer in ocrEngine.ts. The photo never leaves the
// device: these steps only produce another copy of it for the on-device
// recogniser (ADR 0008).

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

const gray = (width: number, height: number, fill = 255): GrayImage => ({
  width,
  height,
  data: new Uint8Array(width * height).fill(fill),
});

// ---------------------------------------------------------------------------
// Tilt

// A pixel is part of a thin horizontal stroke when it is clearly darker than
// the pixels a few rows above and below it. Vertical strokes and flat areas
// (including the table's dark title bar) never qualify.
const RIDGE_MARGIN = 18;
const MAX_TILT = 10;
// A tilt smaller than this is left alone: rotating blurs, and the reader
// copes with half a degree.
const MIN_TILT_TO_CORRECT = 0.5;
// The best angle's concentration of strokes into rows has to beat the
// average angle's by this factor, or the picture has no line structure to
// measure and is left as it is.
const MIN_TILT_CONFIDENCE = 1.6;

function ridgePixels(img: GrayImage): { xs: number[]; ys: number[] } {
  const { width: w, height: h, data: d } = img;
  const k = Math.max(3, Math.round(Math.max(w, h) / 300));
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = k; y < h - k; y += 1) {
    for (let x = k; x < w - k; x += 1) {
      const v = d[y * w + x] + RIDGE_MARGIN;
      if (v >= d[(y - k) * w + x] || v >= d[(y + k) * w + x]) continue;
      // Part of a stroke at least a few pixels long, not speckle.
      const near = d[y * w + x - k] + RIDGE_MARGIN;
      if (near >= d[(y - k) * w + x - k] || near >= d[(y + k) * w + x - k]) {
        continue;
      }
      xs.push(x);
      ys.push(y);
    }
  }
  return { xs, ys };
}

// How strongly the strokes line up into rows when read at a tilt: the sum of
// squared stroke counts per row. It peaks at the angle the lines really run.
function lineAlignment(
  xs: readonly number[],
  ys: readonly number[],
  height: number,
  width: number,
  degrees: number,
): number {
  const slope = Math.tan((degrees * Math.PI) / 180);
  const offset = Math.ceil(Math.abs(slope) * width) + 1;
  const bins = new Int32Array(height + 2 * offset + 2);
  for (let i = 0; i < xs.length; i += 1) {
    bins[Math.round(ys[i] - xs[i] * slope) + offset] += 1;
  }
  let sum = 0;
  for (let i = 0; i < bins.length; i += 1) sum += bins[i] * bins[i];
  return sum;
}

// The clockwise angle, in degrees, at which the table's horizontal lines
// run (positive = lines descend to the right), or 0 when it is small or can't
// be measured reliably. Measured from the thin horizontal strokes, which on
// a table are mostly its grid lines — the dark body of a title bar and
// vertical lines don't take part — and not from all dark pixels, which also
// follow a skewed backdrop.
export function estimateTilt(img: GrayImage): number {
  const { xs, ys } = ridgePixels(img);
  if (xs.length < 50) return 0;
  const { width, height } = img;
  let best = 0;
  let bestScore = -1;
  let total = 0;
  let count = 0;
  for (let a = -MAX_TILT; a <= MAX_TILT + 1e-9; a += 0.25) {
    const score = lineAlignment(xs, ys, height, width, a);
    total += score;
    count += 1;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  if (bestScore < (total / count) * MIN_TILT_CONFIDENCE) return 0;
  let refined = best;
  for (let a = best - 0.25; a <= best + 0.25 + 1e-9; a += 0.05) {
    const score = lineAlignment(xs, ys, height, width, a);
    if (score > bestScore) {
      bestScore = score;
      refined = a;
    }
  }
  return Math.abs(refined) >= MIN_TILT_TO_CORRECT ? refined : 0;
}

// ---------------------------------------------------------------------------
// Straightening and scaling in one resampling

// Maps between the photo and the straightened, scaled copy of it: a copy
// (u, v) pixel is the photo point `centre + R(tilt) · ((u, v) - copyCentre) /
// scale`. Words are recognised in the copy and mapped back, so the review's
// evidence boxes still sit on the photo the user sees.
export interface Transform {
  tilt: number;
  scale: number;
  source: { width: number; height: number };
  copy: { width: number; height: number };
}

function frame(t: Transform) {
  const a = (t.tilt * Math.PI) / 180;
  return {
    cos: Math.cos(a),
    sin: Math.sin(a),
    sx: t.source.width / 2,
    sy: t.source.height / 2,
    cx: t.copy.width / 2,
    cy: t.copy.height / 2,
  };
}

export function transformFor(
  width: number,
  height: number,
  tilt: number,
  scale: number,
): Transform {
  const a = (Math.abs(tilt) * Math.PI) / 180;
  const grownWidth = width * Math.cos(a) + height * Math.sin(a);
  const grownHeight = width * Math.sin(a) + height * Math.cos(a);
  return {
    tilt,
    scale,
    source: { width, height },
    copy: {
      width: Math.max(1, Math.round(grownWidth * scale)),
      height: Math.max(1, Math.round(grownHeight * scale)),
    },
  };
}

// A box in the copy → the smallest box on the photo that holds it.
export function boxToPhoto(box: BBox, t: Transform): BBox {
  const f = frame(t);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [u, v] of [
    [box.x0, box.y0],
    [box.x1, box.y0],
    [box.x0, box.y1],
    [box.x1, box.y1],
  ]) {
    const du = (u - f.cx) / t.scale;
    const dv = (v - f.cy) / t.scale;
    const x = f.sx + du * f.cos - dv * f.sin;
    const y = f.sy + du * f.sin + dv * f.cos;
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return {
    x0: Math.round(Math.max(0, x0)),
    y0: Math.round(Math.max(0, y0)),
    x1: Math.round(Math.min(t.source.width, x1)),
    y1: Math.round(Math.min(t.source.height, y1)),
  };
}

// A rectangle on the photo → the smallest rectangle in the copy that holds it.
export function rectangleToCopy(
  rect: { left: number; top: number; width: number; height: number },
  t: Transform,
): { left: number; top: number; width: number; height: number } {
  const f = frame(t);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [px, py] of [
    [rect.left, rect.top],
    [rect.left + rect.width, rect.top],
    [rect.left, rect.top + rect.height],
    [rect.left + rect.width, rect.top + rect.height],
  ]) {
    const dx = px - f.sx;
    const dy = py - f.sy;
    const u = f.cx + (dx * f.cos + dy * f.sin) * t.scale;
    const v = f.cy + (-dx * f.sin + dy * f.cos) * t.scale;
    x0 = Math.min(x0, u);
    y0 = Math.min(y0, v);
    x1 = Math.max(x1, u);
    y1 = Math.max(y1, v);
  }
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  return {
    left,
    top,
    width: Math.max(1, Math.min(t.copy.width, Math.ceil(x1)) - left),
    height: Math.max(1, Math.min(t.copy.height, Math.ceil(y1)) - top),
  };
}

// Resamples the photo into its straightened, scaled copy (bilinear). Points
// outside the photo repeat its nearest edge pixel, so no white or black wedge
// is invented at the corners.
export function resample(img: GrayImage, t: Transform): GrayImage {
  if (t.tilt === 0 && t.scale === 1) return img;
  const { width: w, height: h, data: d } = img;
  const out = gray(t.copy.width, t.copy.height);
  const f = frame(t);
  const maxX = w - 1.001;
  const maxY = h - 1.001;
  for (let v = 0; v < t.copy.height; v += 1) {
    const dv = (v + 0.5 - f.cy) / t.scale;
    for (let u = 0; u < t.copy.width; u += 1) {
      const du = (u + 0.5 - f.cx) / t.scale;
      const sx = Math.min(
        maxX,
        Math.max(0, f.sx + du * f.cos - dv * f.sin - 0.5),
      );
      const sy = Math.min(
        maxY,
        Math.max(0, f.sy + du * f.sin + dv * f.cos - 0.5),
      );
      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;
      const i = y0 * w + x0;
      out.data[v * t.copy.width + u] =
        d[i] * (1 - fx) * (1 - fy) +
        d[i + 1] * fx * (1 - fy) +
        d[i + w] * (1 - fx) * fy +
        d[i + w + 1] * fx * fy +
        0.5;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dark bands

function otsuThreshold(data: Uint8Array | Uint8ClampedArray): number {
  const hist = new Float64Array(256);
  for (let i = 0; i < data.length; i += 1) hist[data[i]] += 1;
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let below = 0;
  let belowSum = 0;
  let best = 0;
  // Any cut between two separated groups of grays separates them equally
  // well: take the middle of that stretch, not its first gray.
  let first = 128;
  let last = 128;
  for (let i = 0; i < 256; i += 1) {
    below += hist[i];
    const above = data.length - below;
    if (below === 0) continue;
    if (above === 0) break;
    belowSum += i * hist[i];
    const gap = belowSum / below - (sum - belowSum) / above;
    const between = below * above * gap * gap;
    if (between > best) {
      best = between;
      first = i;
      last = i;
    } else if (between === best) {
      last = i;
    }
  }
  return (first + last) / 2;
}

// Share of a title bar's pixels that are near-black (the rest is its letters).
const MIN_BAND_DARKNESS = 0.6;

// The share of near-black pixels in one row of cells, from cell `first` to
// cell `last`.
function darkShare(
  d: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  cell: number,
  gy: number,
  first: number,
  last: number,
  threshold: number,
): number {
  let dark = 0;
  let all = 0;
  for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 1) {
    for (let x = first * cell; x < Math.min(w, (last + 1) * cell); x += 1) {
      all += 1;
      if (d[y * w + x] < threshold) dark += 1;
    }
  }
  return all > 0 ? dark / all : 0;
}

interface Band {
  x0: number;
  x1: number;
  // Its run of cells in each row of cells: [row, first, last].
  rows: Array<[number, number, number]>;
}

// Whether any (dilation) or every (erosion) cell in the square window around
// each cell is set, through a summed-area table.
function morph(
  cells: Uint8Array,
  gw: number,
  gh: number,
  radius: number,
  every: boolean,
): Uint8Array {
  const stride = gw + 1;
  const sums = new Uint32Array(stride * (gh + 1));
  for (let y = 0; y < gh; y += 1) {
    let row = 0;
    for (let x = 0; x < gw; x += 1) {
      row += cells[y * gw + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const out = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y += 1) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(gh, y + radius + 1);
    for (let x = 0; x < gw; x += 1) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(gw, x + radius + 1);
      const set =
        sums[y1 * stride + x1] -
        sums[y0 * stride + x1] -
        sums[y1 * stride + x0] +
        sums[y0 * stride + x0];
      out[y * gw + x] = every
        ? set === (x1 - x0) * (y1 - y0)
          ? 1
          : 0
        : set > 0
          ? 1
          : 0;
    }
  }
  return out;
}

// Light text on a dark bar (a table's title row) turns into dark text on a
// light bar, the way every other row reads. Without it, evening out the
// lighting would wipe the bar out. A band is a wide, thin, solid dark block —
// found on a coarse grid of cells, with the light letters closed over and
// the table's thin dark outline opened away, so neither joins it.
export function invertDarkBands(img: GrayImage): GrayImage {
  const { width: w, height: h, data: d } = img;
  const longSide = Math.max(w, h);
  const cell = Math.max(2, Math.floor(longSide / 500));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  // Well below the paper-to-ink cut-off: a title bar is nearly black, while
  // shadow and dark backdrops around the table are not.
  const threshold = otsuThreshold(d) * 0.5;
  const dense = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy += 1) {
    for (let gx = 0; gx < gw; gx += 1) {
      let dark = 0;
      let all = 0;
      for (let y = gy * cell; y < Math.min(h, (gy + 1) * cell); y += 1) {
        for (let x = gx * cell; x < Math.min(w, (gx + 1) * cell); x += 1) {
          all += 1;
          if (d[y * w + x] < threshold) dark += 1;
        }
      }
      dense[gy * gw + gx] = dark >= all * 0.25 ? 1 : 0;
    }
  }
  const minThickness = Math.max(12, 0.015 * longSide) / cell;
  const closing = Math.max(1, Math.round(longSide / 150 / cell));
  // The opening window stays under the thinnest bar, so it removes lines
  // and keeps bars.
  const opening = Math.max(2, Math.floor((minThickness - 1) / 2));
  const solid = morph(
    morph(
      morph(morph(dense, gw, gh, closing, false), gw, gh, closing, true),
      gw,
      gh,
      opening,
      true,
    ),
    gw,
    gh,
    opening,
    false,
  );

  // A band is a run of solid cells across a good part of the table, held for
  // enough rows to be thicker than any line. Following each row's own run
  // keeps a slightly tilted band's edges.
  const minLength = Math.max(60, 0.2 * w) / cell;
  const maxThickness = (0.15 * longSide) / cell;
  const bands: Band[] = [];
  let open: Band[] = [];
  for (let gy = 0; gy <= gh; gy += 1) {
    const next: Band[] = [];
    let first = -1;
    for (let gx = 0; gx <= gw; gx += 1) {
      const on = gy < gh && gx < gw && solid[gy * gw + gx] === 1;
      if (on) {
        if (first < 0) first = gx;
      } else if (first >= 0) {
        const last = gx - 1;
        // Bold dark text with its row lines can look like a bar to the grid;
        // a real bar is near-black under its light letters too.
        if (
          last - first + 1 >= minLength &&
          darkShare(d, w, h, cell, gy, first, last, threshold) >=
            MIN_BAND_DARKNESS
        ) {
          const joined = open.find(
            (b) =>
              b.rows[b.rows.length - 1][0] === gy - 1 &&
              Math.min(b.x1, last) - Math.max(b.x0, first) >=
                0.5 * Math.min(b.x1 - b.x0, last - first),
          );
          if (joined) {
            joined.rows.push([gy, first, last]);
            joined.x0 = Math.min(joined.x0, first);
            joined.x1 = Math.max(joined.x1, last);
            next.push(joined);
          } else {
            next.push({ x0: first, x1: last, rows: [[gy, first, last]] });
          }
        }
        first = -1;
      }
    }
    for (const b of open) if (!next.includes(b)) bands.push(b);
    open = next;
  }
  const invert = new Uint8Array(gw * gh);
  let any = false;
  for (const band of bands) {
    if (band.rows.length < minThickness || band.rows.length > maxThickness) {
      continue;
    }
    any = true;
    for (const [gy, first, last] of band.rows) {
      for (let gx = first; gx <= last; gx += 1) invert[gy * gw + gx] = 1;
    }
  }
  if (!any) return img;

  const out: GrayImage = { width: w, height: h, data: Uint8Array.from(d) };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (invert[Math.floor(y / cell) * gw + Math.floor(x / cell)] === 1) {
        out.data[y * w + x] = 255 - d[y * w + x];
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grid lines

// Local mean over a box, via a summed-area table.
function boxMeans(img: GrayImage, window: number): Float32Array {
  const { width: w, height: h, data: d } = img;
  const stride = w + 1;
  const sums = new Uint32Array(stride * (h + 1));
  for (let y = 0; y < h; y += 1) {
    let row = 0;
    for (let x = 0; x < w; x += 1) {
      row += d[y * w + x];
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const r = window >> 1;
  const means = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      means[y * w + x] =
        (sums[y1 * stride + x1] -
          sums[y0 * stride + x1] -
          sums[y1 * stride + x0] +
          sums[y0 * stride + x0]) /
        ((x1 - x0) * (y1 - y0));
    }
  }
  return means;
}

// Marks the pixels of dark lines at least `minLength` long that run at the
// given slope (cross-axis pixels per pixel along the line). A run may also
// drift a pixel sideways at any point and still counts as one line, so a
// table that isn't perfectly straight (perspective, a crease) still loses
// its lines. `along` is the direction scanned: rows for horizontal lines,
// columns for vertical ones.
function markLines(
  dark: Uint8Array,
  w: number,
  h: number,
  along: 'row' | 'column',
  slope: number,
  minLength: number,
  mask: Uint8Array,
): void {
  const lines = along === 'row' ? h : w;
  const length = along === 'row' ? w : h;
  const at = (line: number, pos: number) =>
    along === 'row' ? line * w + pos : pos * w + line;
  const shift = Math.ceil(Math.abs(slope) * length) + 1;
  for (let first = -shift; first < lines + shift; first += 1) {
    let start = -1;
    for (let pos = 0; pos <= length; pos += 1) {
      let on = false;
      if (pos < length) {
        const line = first + Math.round(pos * slope);
        if (line >= 0 && line < lines) {
          on =
            dark[at(line, pos)] === 1 ||
            (line > 0 && dark[at(line - 1, pos)] === 1) ||
            (line < lines - 1 && dark[at(line + 1, pos)] === 1);
        }
      }
      if (on) {
        if (start < 0) start = pos;
      } else if (start >= 0) {
        if (pos - start >= minLength) {
          for (let p = start; p < pos; p += 1) {
            const i = at(first + Math.round(p * slope), p);
            if (dark[i] === 1) mask[i] = 1;
          }
        }
        start = -1;
      }
    }
  }
}

// Slopes tried for horizontal and vertical lines, `step` apart (a run
// tolerates being a pixel off, so a slope also catches lines near it). After
// straightening, what is left is the table's perspective: rows fan out by a
// few degrees, and verticals lean more than rows do.
function slopesUpTo(limit: number, step: number): number[] {
  const n = Math.max(0, Math.ceil(limit / step - 0.5));
  return Array.from({ length: 2 * n + 1 }, (_, i) => (i - n) * step);
}

// Erases long thin dark lines (a table's grid) by filling their pixels from
// the nearest pixels beside them. Text strokes are never long enough to be
// taken for a line.
export function removeGridLines(img: GrayImage): GrayImage {
  const { width: w, height: h, data: d } = img;
  const longSide = Math.max(w, h);
  const means = boxMeans(img, Math.max(15, Math.round(longSide / 40) | 1));

  // Lines are found on a coarser copy of the dark pixels on large images
  // (every line still has two or more pixels of thickness there), which
  // makes the search several times cheaper; the lines are then cleared at
  // full size, only where the full-size pixel is itself dark.
  const f = longSide > 1000 ? 2 : 1;
  const cw = Math.ceil(w / f);
  const ch = Math.ceil(h / f);
  const dark = new Uint8Array(w * h);
  const votes = new Uint8Array(cw * ch);
  for (let y = 0; y < h; y += 1) {
    const voteRow = Math.floor(y / f) * cw;
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (d[i] < means[i] - 18) {
        dark[i] = 1;
        votes[voteRow + Math.floor(x / f)] += 1;
      }
    }
  }
  const coarse = new Uint8Array(cw * ch);
  for (let i = 0; i < coarse.length; i += 1) {
    coarse[i] = votes[i] * 2 >= f * f ? 1 : 0;
  }

  // Long enough that no word is mistaken for one: the joined baseline of an
  // Arabic word is a long thin dark run too, but a grid line crosses a
  // cell and usually the whole table.
  const minLength = Math.max(40, Math.round(longSide * 0.15)) / f;
  const coarseMask = new Uint8Array(cw * ch);
  for (const slope of slopesUpTo(0.06, 0.03 * f)) {
    markLines(coarse, cw, ch, 'row', slope, minLength, coarseMask);
  }
  for (const slope of slopesUpTo(0.09, 0.03 * f)) {
    markLines(coarse, cw, ch, 'column', slope, minLength, coarseMask);
  }

  // The line pixels, grown by a pixel over the lines' soft edges.
  const mask = new Uint8Array(w * h);
  const painted: number[] = [];
  for (let y = 0; y < h; y += 1) {
    const maskRow = Math.floor(y / f) * cw;
    for (let x = 0; x < w; x += 1) {
      if (
        dark[y * w + x] === 0 ||
        coarseMask[maskRow + Math.floor(x / f)] === 0
      ) {
        continue;
      }
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy += 1) {
        for (
          let xx = Math.max(0, x - 1);
          xx <= Math.min(w - 1, x + 1);
          xx += 1
        ) {
          if (mask[yy * w + xx] === 0) {
            mask[yy * w + xx] = 1;
            painted.push(yy * w + xx);
          }
        }
      }
    }
  }
  if (painted.length === 0) return img;

  // Each line pixel becomes the average of the nearest untouched pixels
  // above, below, left and right of it, nearer ones counting more.
  const out: GrayImage = { width: w, height: h, data: Uint8Array.from(d) };
  const reach = 14;
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const i of painted) {
    const x = i % w;
    const y = (i - x) / w;
    let sum = 0;
    let weight = 0;
    for (const [dx, dy] of directions) {
      for (let k = 1; k <= reach; k += 1) {
        const xx = x + dx * k;
        const yy = y + dy * k;
        if (xx < 0 || xx >= w || yy < 0 || yy >= h) break;
        if (mask[yy * w + xx] === 1) continue;
        sum += d[yy * w + xx] / k;
        weight += 1 / k;
        break;
      }
    }
    out.data[i] = weight > 0 ? Math.round(sum / weight) : 255;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Lighting

// Divides every pixel by the average around it, so glare, shadow and the
// gloss of foil stop mattering and ink is dark against an even background.
// The result is a grayscale image, not a black-and-white one: Tesseract
// reads its own thresholding of it better than any fixed cut-off.
export function flatField(img: GrayImage, window?: number): GrayImage {
  const { width: w, height: h, data: d } = img;
  const size =
    window ?? Math.min(81, Math.max(31, Math.round(Math.max(w, h) * 0.04) | 1));
  const means = boxMeans(img, size);
  const out = gray(w, h);
  for (let i = 0; i < out.data.length; i += 1) {
    out.data[i] = Math.min(255, (d[i] / Math.max(means[i], 1)) * 235 + 0.5);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Number crops

// Ink in the cleaned copy: paper is evened out to ~235 and print sits well
// below it, while the faint trace of an erased line (~130-150) stays above.
const INK = 117;

// The crop to re-read a number from: tight round the ink the page pass found
// it in, not round the box it reported. A recognised box can reach over a
// neighbouring row or the unit beside it, and a single-line read of a crop
// like that drops decimal points or reads a neighbour's text into the number
// ("83.651" came back "83651" with "(g)" and a cell edge in view, and exactly
// right from a crop of the digits alone). Ink within a gap of 0.7 character
// heights is kept with it, so a box that held only part of a number (the last
// digits of one the Arabic pass cut short) still gets the whole of it.
// Undefined when no ink is found in the box.
export function numberInkCrop(
  img: GrayImage,
  box: BBox,
): { left: number; top: number; width: number; height: number } | undefined {
  const { width: w, height: h, data: d } = img;
  const bx0 = Math.max(0, Math.floor(box.x0));
  const bx1 = Math.min(w, Math.ceil(box.x1));
  const by0 = Math.max(0, Math.floor(box.y0));
  const by1 = Math.min(h, Math.ceil(box.y1));
  if (bx1 <= bx0 || by1 <= by0) return undefined;

  // The rows of ink inside the box: the band holding the most ink.
  const speck = Math.max(1, Math.round((bx1 - bx0) * 0.02));
  let band: { y0: number; y1: number; ink: number } | undefined;
  let open: { y0: number; y1: number; ink: number } | undefined;
  let gap = 0;
  for (let y = by0; y <= by1; y += 1) {
    let ink = 0;
    if (y < by1) {
      for (let x = bx0; x < bx1; x += 1) if (d[y * w + x] < INK) ink += 1;
    }
    if (ink >= speck) {
      if (open) {
        open.y1 = y;
        open.ink += ink;
      } else {
        open = { y0: y, y1: y, ink };
      }
      gap = 0;
    } else if (open) {
      gap += 1;
      if (gap > 2 || y === by1) {
        if (!band || open.ink > band.ink) band = open;
        open = undefined;
      }
    }
  }
  if (!band) return undefined;
  const textHeight = band.y1 - band.y0 + 1;

  // The ink columns of that band, kept as one run across small gaps; the run
  // that overlaps the box most is the number.
  const wx0 = Math.max(0, Math.floor(box.x0 - 2.5 * textHeight));
  const wx1 = Math.min(w, Math.ceil(box.x1 + 2.5 * textHeight));
  const runs: Array<[number, number]> = [];
  let last = -Infinity;
  for (let x = wx0; x < wx1; x += 1) {
    let inked = false;
    for (let y = band.y0; y <= band.y1 && !inked; y += 1) {
      inked = d[y * w + x] < INK;
    }
    if (!inked) continue;
    if (runs.length > 0 && x - last <= 0.7 * textHeight) {
      runs[runs.length - 1][1] = x;
    } else {
      runs.push([x, x]);
    }
    last = x;
  }
  let best: [number, number] | undefined;
  let bestOverlap = 0;
  for (const run of runs) {
    const overlap = Math.min(run[1] + 1, bx1) - Math.max(run[0], bx0);
    if (overlap > bestOverlap) {
      best = run;
      bestOverlap = overlap;
    }
  }
  if (!best) return undefined;

  const left = Math.max(0, Math.round(best[0] - 0.35 * textHeight));
  const top = Math.max(0, Math.round(band.y0 - 0.3 * textHeight));
  const right = Math.min(w, Math.round(best[1] + 1 + 0.35 * textHeight));
  const bottom = Math.min(h, Math.round(band.y1 + 1 + 0.3 * textHeight));
  return { left, top, width: right - left, height: bottom - top };
}

// How much a number's crop is enlarged for its re-read: to characters about
// 65 px tall, never shrunk and never past 3x. A single-line read of a small
// crop drops decimal points ("415.932" came back "415932"); enlarged a
// little it reads them, but enlarged a lot it starts misreading digits
// ("6.51" → "6.5]"), so 65 px was the best of 50, 65 and 90 on the label
// measured.
export function rereadScale(cropHeight: number): number {
  return Math.min(3, Math.max(1, 65 / Math.max(1, cropHeight)));
}

// A rectangle of the cleaned copy, enlarged (bilinear).
export function enlargeCrop(
  img: GrayImage,
  rect: { left: number; top: number; width: number; height: number },
  factor: number,
): GrayImage {
  const { width: w, height: h, data: d } = img;
  const width = Math.max(1, Math.round(rect.width * factor));
  const height = Math.max(1, Math.round(rect.height * factor));
  const out = gray(width, height);
  for (let v = 0; v < height; v += 1) {
    const sy = Math.min(
      h - 1.001,
      Math.max(0, rect.top + (v + 0.5) / factor - 0.5),
    );
    const y0 = sy | 0;
    const fy = sy - y0;
    for (let u = 0; u < width; u += 1) {
      const sx = Math.min(
        w - 1.001,
        Math.max(0, rect.left + (u + 0.5) / factor - 0.5),
      );
      const x0 = sx | 0;
      const fx = sx - x0;
      const i = y0 * w + x0;
      out.data[v * width + u] =
        d[i] * (1 - fx) * (1 - fy) +
        d[i + 1] * fx * (1 - fy) +
        d[i + w] * (1 - fx) * fy +
        d[i + w + 1] * fx * fy +
        0.5;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The whole preparation

export interface CleanedLabel {
  image: GrayImage;
  transform: Transform;
}

// How much larger than the photo the cleaned copy is made: small tables are
// enlarged so characters reach a size the recogniser reads well, never
// beyond 2x, and photos that already are large are left at their size.
export function workingScale(width: number, height: number): number {
  return Math.min(2, Math.max(1, 1400 / Math.max(width, height)));
}

export function cleanForRecognition(photo: GrayImage): CleanedLabel {
  const tilt = estimateTilt(photo);
  const transform = transformFor(
    photo.width,
    photo.height,
    tilt,
    workingScale(photo.width, photo.height),
  );
  const straight = resample(photo, transform);
  const image = flatField(removeGridLines(invertDarkBands(straight)));
  return { image, transform };
}
