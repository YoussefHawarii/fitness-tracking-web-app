import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// The label camera's guide frames and the still it takes of what is inside
// one: the frames have the shapes the user sees (tall 3:4, wide 2:1), and
// the still is exactly the source pixels under the frame, at the video's own
// resolution, never the size the video is shown at.

let vite;
let frameModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  frameModule = await vite.ssrLoadModule(
    '/src/features/label-scan/labelFrame.ts',
  );
});

after(async () => {
  await vite.close();
});

// The viewfinder is a 3:4 box; the frames are fractions of it.
for (const [viewWidth, viewHeight] of [
  [300, 400],
  [600, 800],
]) {
  test(`the tall frame is 3:4 and the wide frame 2:1 on screen, in a ${viewWidth}×${viewHeight} view`, () => {
    const { LABEL_FRAMES } = frameModule;
    const onScreen = ({ width, height }) => ({
      width: width * viewWidth,
      height: height * viewHeight,
    });

    const tall = onScreen(LABEL_FRAMES.tall);
    assert.ok(Math.abs(tall.width / tall.height - 3 / 4) < 1e-9);

    const wide = onScreen(LABEL_FRAMES.wide);
    assert.ok(Math.abs(wide.width / wide.height - 2) < 1e-9);
  });
}

test('both frames sit inside the viewfinder, centred', () => {
  const { LABEL_FRAMES } = frameModule;
  for (const { x, y, width, height } of Object.values(LABEL_FRAMES)) {
    assert.ok(x >= 0 && y >= 0 && x + width <= 1 && y + height <= 1);
    assert.ok(Math.abs(x + width / 2 - 0.5) < 1e-9);
    assert.ok(Math.abs(y + height / 2 - 0.5) < 1e-9);
  }
});

// A <video> as the capture reads it, shown in a 300 × 400 box.
function fakeVideo(overrides = {}) {
  return {
    readyState: 4,
    videoWidth: 3840,
    videoHeight: 2160,
    clientWidth: 300,
    clientHeight: 400,
    ...overrides,
  };
}

// A canvas that records what is drawn on it and hands out a given blob.
function fakeCanvas(blob = { fake: 'png' }) {
  const canvas = {
    width: 0,
    height: 0,
    draws: [],
    blobTypes: [],
    getContext: () => ({
      drawImage: (...args) => canvas.draws.push(args),
    }),
    toBlob: (callback, type) => {
      canvas.blobTypes.push(type);
      callback(blob);
    },
  };
  return canvas;
}

test('the still is exactly the source pixels under the tall frame, at native resolution', async () => {
  const { captureFramedStill } = frameModule;
  // A landscape stream in a portrait box: object-cover shows the middle
  // 1620 × 2160 of it (x from 1110), and the frame is 80% of that.
  const video = fakeVideo();
  const canvas = fakeCanvas();

  const photo = await captureFramedStill(video, 'tall', () => canvas);

  assert.deepEqual(canvas.draws, [
    [video, 1272, 216, 1296, 1728, 0, 0, 1296, 1728],
  ]);
  // The still has the source region's size, not the 300 × 400 it is shown at.
  assert.equal(canvas.width, 1296);
  assert.equal(canvas.height, 1728);
  assert.deepEqual(canvas.blobTypes, ['image/png']);
  assert.deepEqual(photo, { fake: 'png' });
});

test('the still is exactly the source pixels under the wide frame, at native resolution', async () => {
  const { captureFramedStill } = frameModule;
  const video = fakeVideo();
  const canvas = fakeCanvas();

  await captureFramedStill(video, 'wide', () => canvas);

  assert.equal(canvas.draws.length, 1);
  const [source, sx, sy, sw, sh, dx, dy, dw, dh] = canvas.draws[0];
  assert.equal(source, video);
  // 90% of the visible 1620 across, 33.75% of the 2160 down, centred.
  assert.equal(sx, 1191);
  assert.equal(sw, 1458);
  assert.equal(sh, 729);
  assert.ok(Math.abs(sy - 715.5) <= 0.5, `top ${sy}`);
  assert.deepEqual([dx, dy, dw, dh], [0, 0, sw, sh]);
  assert.equal(canvas.width, sw);
  assert.equal(canvas.height, sh);
  // 2:1 in the picture, as on screen.
  assert.equal(sw / sh, 2);
});

test('a portrait stream is cropped to the frame the same way', async () => {
  const { captureFramedStill } = frameModule;
  // object-cover shows the middle 2160 × 2880 (from y = 480) of a 2160 × 3840
  // stream shown in the 300 × 400 box.
  const video = fakeVideo({ videoWidth: 2160, videoHeight: 3840 });
  const canvas = fakeCanvas();

  await captureFramedStill(video, 'tall', () => canvas);

  assert.deepEqual(canvas.draws, [
    [video, 216, 768, 1728, 2304, 0, 0, 1728, 2304],
  ]);
});

test('no still is taken before the video has a frame', async () => {
  const { captureFramedStill } = frameModule;
  for (const overrides of [
    { readyState: 0 },
    { readyState: 1 },
    { videoWidth: 0 },
    { videoHeight: 0 },
    { clientWidth: 0 },
    { clientHeight: 0 },
  ]) {
    let created = 0;
    const photo = await captureFramedStill(fakeVideo(overrides), 'tall', () => {
      created += 1;
      return fakeCanvas();
    });
    assert.equal(photo, null, JSON.stringify(overrides));
    assert.equal(created, 0, 'no canvas is made');
  }
});

test('no still is returned when the canvas cannot make one', async () => {
  const { captureFramedStill } = frameModule;
  assert.equal(
    await captureFramedStill(fakeVideo(), 'tall', () => fakeCanvas(null)),
    null,
  );
  const noContext = fakeCanvas();
  noContext.getContext = () => null;
  assert.equal(
    await captureFramedStill(fakeVideo(), 'tall', () => noContext),
    null,
  );
});
