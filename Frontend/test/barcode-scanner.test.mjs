import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

// Tracer-bullet tests for the scanner rework (horizontal scan region, higher
// resolution, zoom/torch). Seams agreed up front:
//   A. camera-capabilities — pure functions over plain capability data
//   B. scan-region         — on-screen guide box -> source-frame crop
//   C. scan-session        — framework-free state machine; the camera is a
//                            fake at the getUserMedia boundary
//   D. ScannerView         — presentational component, SSR-rendered
// Each test loads its module itself so a missing module fails only its own
// tests, not the whole file.

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

// Realistic getCapabilities() shapes, as reported by the browsers.
const ANDROID_CHROME_CAPABILITIES = {
  facingMode: ['environment'],
  width: { min: 1, max: 4000 },
  height: { min: 1, max: 3000 },
  zoom: { min: 1, max: 8, step: 0.1 },
  torch: true,
  focusMode: ['manual', 'single-shot', 'continuous'],
};
const IOS_SAFARI_CAPABILITIES = {
  facingMode: ['environment'],
  width: { min: 1, max: 1920 },
  height: { min: 1, max: 1080 },
};

// ---------------------------------------------------------------- A

test('camera request prefers the rear camera at 1080p without demanding it', async () => {
  const { buildCameraConstraints } = await load(`${FEATURE}/camera-capabilities.ts`);

  const constraints = buildCameraConstraints();

  assert.equal(constraints.audio, false);
  // `ideal`, not `exact`: laptops with only a front camera must still work.
  assert.deepEqual(constraints.video.facingMode, { ideal: 'environment' });
  assert.deepEqual(constraints.video.width, { ideal: 1920 });
  assert.deepEqual(constraints.video.height, { ideal: 1080 });
});

test('zoom and torch are offered only when the camera reports them', async () => {
  const { detectCameraFeatures, chooseZoom } = await load(
    `${FEATURE}/camera-capabilities.ts`,
  );

  const android = detectCameraFeatures(ANDROID_CHROME_CAPABILITIES);
  assert.deepEqual(android, {
    zoom: { min: 1, max: 8, step: 0.1 },
    torch: true,
    continuousFocus: true,
  });
  assert.equal(chooseZoom(android), 2);

  const ios = detectCameraFeatures(IOS_SAFARI_CAPABILITIES);
  assert.deepEqual(ios, { zoom: null, torch: false, continuousFocus: false });
  assert.equal(chooseZoom(ios), null);
});

// ---------------------------------------------------------------- B
// Guide box: 80% wide, 30% tall, centred — in view fractions.
const GUIDE_BOX = { x: 0.1, y: 0.35, width: 0.8, height: 0.3 };

test('landscape frame in a square view: crop skips the sides object-cover hides', async () => {
  const { computeScanRegion } = await load(`${FEATURE}/scan-region.ts`);

  // 1920x1080 covering a 400x400 view shows source x 420..1500, y 0..1080.
  const region = computeScanRegion({
    videoWidth: 1920,
    videoHeight: 1080,
    viewWidth: 400,
    viewHeight: 400,
    box: GUIDE_BOX,
  });

  assert.deepEqual(region, { x: 528, y: 378, width: 864, height: 324 });
});

test('portrait frame in a square view: crop skips the top and bottom instead', async () => {
  const { computeScanRegion } = await load(`${FEATURE}/scan-region.ts`);

  // 1080x1920 covering a 400x400 view shows source x 0..1080, y 420..1500.
  const region = computeScanRegion({
    videoWidth: 1080,
    videoHeight: 1920,
    viewWidth: 400,
    viewHeight: 400,
    box: GUIDE_BOX,
  });

  assert.deepEqual(region, { x: 108, y: 798, width: 864, height: 324 });
});

// ---------------------------------------------------------------- C

// Fake at the system boundary (getUserMedia + MediaStreamTrack). Records what
// was asked of the device so tests can check effects on the camera itself.
function fakeCamera({ capabilities = ANDROID_CHROME_CAPABILITIES, openError } = {}) {
  const endedListeners = new Set();
  const device = {
    requested: null,
    zoom: null,
    torch: false,
    stopped: false,
    stopCount: 0,
    opens: 0,
    // The OS took the camera away (screen lock, app switch, incoming call).
    end: () => endedListeners.forEach((listener) => listener()),
    endedListenerCount: () => endedListeners.size,
  };
  return {
    device,
    async openCamera(constraints) {
      device.opens += 1;
      device.requested = constraints;
      if (openError) throw openError;
      return {
        capabilities,
        async applyZoom(level) {
          device.zoom = level;
        },
        async setTorch(on) {
          device.torch = on;
        },
        onEnded(listener) {
          endedListeners.add(listener);
          return () => endedListeners.delete(listener);
        },
        stop() {
          device.stopped = true;
          device.stopCount += 1;
        },
      };
    },
  };
}

// A camera whose open the test resolves by hand, to exercise races.
function deferredCamera(capabilities = IOS_SAFARI_CAPABILITIES) {
  const inner = fakeCamera({ capabilities });
  const pending = [];
  return {
    device: inner.device,
    requests: () => pending.length,
    openCamera(constraints) {
      return new Promise((resolve, reject) => {
        pending.push(() => inner.openCamera(constraints).then(resolve, reject));
      });
    },
    resolveOpen: async () => {
      pending.shift()();
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

test('a camera taken away mid-scan leaves a recoverable interrupted state, not a fake scanning one', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera({ capabilities: ANDROID_CHROME_CAPABILITIES });
  const session = createScanSession({ openCamera: camera.openCamera, onBarcode: () => {} });

  await session.start();
  camera.device.end();

  assert.equal(session.getState().status, 'interrupted');
  assert.deepEqual(session.getState().torch, { available: false, on: false });
  assert.equal(camera.device.endedListenerCount(), 0);
  // Reads that were already in flight must not confirm anything now.
  session.reportDecode('5901234123457');
  session.reportDecode('5901234123457');
  assert.equal(session.getState().status, 'interrupted');

  await session.start();
  assert.equal(session.getState().status, 'scanning');
});

test('stopping the session removes its ended listener', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera();
  const session = createScanSession({ openCamera: camera.openCamera, onBarcode: () => {} });

  await session.start();
  assert.equal(camera.device.endedListenerCount(), 1);
  session.stop();
  assert.equal(camera.device.endedListenerCount(), 0);
});

test('stopping while the camera is still opening releases the late camera and never scans', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = deferredCamera();
  const session = createScanSession({ openCamera: camera.openCamera, onBarcode: () => {} });
  const seen = [];
  session.subscribe(() => seen.push(session.getState().status));

  const starting = session.start();
  session.stop(); // unmount (or StrictMode's replay) before the camera answers
  await camera.resolveOpen();
  await starting;

  assert.equal(camera.device.stopCount, 1);
  assert.ok(!seen.includes('scanning'), `statuses seen: ${seen.join(', ')}`);
});

test('a zoom the device rejects does not stop scanning and is not reported as applied', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera({ capabilities: ANDROID_CHROME_CAPABILITIES });
  const session = createScanSession({
    openCamera: async (constraints) => ({
      ...(await camera.openCamera(constraints)),
      applyZoom: async () => {
        throw new DOMException('rejected', 'OverconstrainedError');
      },
    }),
    onBarcode: () => {},
  });

  await session.start();

  assert.equal(session.getState().status, 'scanning');
  assert.equal(session.getState().zoom, null);
});

test('a torch the device rejects keeps scanning and never claims to be on', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera({ capabilities: ANDROID_CHROME_CAPABILITIES });
  const session = createScanSession({
    openCamera: async (constraints) => ({
      ...(await camera.openCamera(constraints)),
      setTorch: async () => {
        throw new DOMException('rejected', 'NotReadableError');
      },
    }),
    onBarcode: () => {},
  });

  await session.start();
  await session.toggleTorch();

  assert.equal(session.getState().status, 'scanning');
  assert.deepEqual(session.getState().torch, { available: true, on: false });
});

test('retrying after a permission denial reaches scanning once the camera opens', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  let allowed = false;
  const working = fakeCamera();
  const session = createScanSession({
    openCamera: async (constraints) => {
      if (!allowed) throw new DOMException('denied', 'NotAllowedError');
      return working.openCamera(constraints);
    },
    onBarcode: () => {},
  });

  await session.start();
  assert.equal(session.getState().status, 'permission-denied');

  allowed = true; // the user allowed the camera in browser settings
  await session.start();
  assert.equal(session.getState().status, 'scanning');
});

test('overlapping start attempts open only one camera', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = deferredCamera();
  const session = createScanSession({ openCamera: camera.openCamera, onBarcode: () => {} });

  const first = session.start();
  const second = session.start();
  assert.equal(camera.requests(), 1);
  await camera.resolveOpen();
  await Promise.all([first, second]);

  assert.equal(camera.device.opens, 1);
  assert.equal(session.getState().status, 'scanning');
});

test('confirming a barcode releases the camera exactly once', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera();
  const session = createScanSession({ openCamera: camera.openCamera, onBarcode: () => {} });

  await session.start();
  session.reportDecode('5901234123457');
  session.reportDecode('5901234123457');
  assert.equal(camera.device.stopCount, 1);

  // Unmount cleanup afterwards must not stop it a second time.
  session.stop();
  assert.equal(camera.device.stopCount, 1);
});

test('a barcode is emitted once, after two matching reads, and again only by a fresh session', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera();
  const emitted = [];
  const session = createScanSession({
    openCamera: camera.openCamera,
    onBarcode: (code) => emitted.push(code),
  });

  await session.start();
  assert.equal(session.getState().status, 'scanning');

  session.reportDecode('5901234123457');
  assert.equal(session.getState().status, 'scanning'); // one read is not enough
  session.reportDecode('5901234123457');
  assert.equal(session.getState().status, 'decoded');
  assert.equal(session.getState().barcode, '5901234123457');

  // The camera keeps seeing the same code; nothing more is emitted.
  session.reportDecode('5901234123457');
  session.reportDecode('5901234123457');

  // FoodLog rescans by remounting the scanner, i.e. with a fresh session;
  // that one can confirm the very same barcode again.
  const rescan = createScanSession({
    openCamera: fakeCamera().openCamera,
    onBarcode: (code) => emitted.push(code),
  });
  await rescan.start();
  rescan.reportDecode('5901234123457');
  rescan.reportDecode('5901234123457');

  assert.deepEqual(emitted, ['5901234123457', '5901234123457']);
});

test('supported zoom is applied on start and the torch can be toggled', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera({ capabilities: ANDROID_CHROME_CAPABILITIES });
  const session = createScanSession({ openCamera: camera.openCamera, onBarcode: () => {} });

  await session.start();
  assert.equal(camera.device.zoom, 2);
  assert.deepEqual(session.getState().torch, { available: true, on: false });

  await session.toggleTorch();
  assert.equal(camera.device.torch, true);
  assert.deepEqual(session.getState().torch, { available: true, on: true });
});

test('a camera without zoom or torch is left alone', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);
  const camera = fakeCamera({ capabilities: IOS_SAFARI_CAPABILITIES });
  const session = createScanSession({ openCamera: camera.openCamera, onBarcode: () => {} });

  await session.start();

  assert.equal(camera.device.zoom, null);
  assert.deepEqual(session.getState().torch, { available: false, on: false });
});

test('denied permission and a missing camera are distinct failure states', async () => {
  const { createScanSession } = await load(`${FEATURE}/scan-session.ts`);

  const denied = createScanSession({
    openCamera: fakeCamera({ openError: new DOMException('denied', 'NotAllowedError') })
      .openCamera,
    onBarcode: () => {},
  });
  await denied.start();
  assert.equal(denied.getState().status, 'permission-denied');

  const missing = createScanSession({
    openCamera: fakeCamera({ openError: new DOMException('none', 'NotFoundError') })
      .openCamera,
    onBarcode: () => {},
  });
  await missing.start();
  assert.equal(missing.getState().status, 'unavailable');
});

// The camera must not be requested until the <video> it plays into is in the
// DOM ("Try again" re-renders the video from an error view). The gate is fed
// by React's callback ref, so ordering never depends on render timing.
test('the video gate holds camera startup until a video element is attached', async () => {
  const { createElementGate } = await load(`${FEATURE}/element-gate.ts`);
  const gate = createElementGate();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  let attached = null;
  gate.whenReady().then((element) => (attached = element));
  await settle();
  assert.equal(attached, null);

  gate.set('video-1');
  await settle();
  assert.equal(attached, 'video-1');
});

test('the video gate waits again after the video is unmounted', async () => {
  const { createElementGate } = await load(`${FEATURE}/element-gate.ts`);
  const gate = createElementGate();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  gate.set('video-1');
  gate.set(null); // the error view replaced the video
  let attached = null;
  gate.whenReady().then((element) => (attached = element));
  await settle();
  assert.equal(attached, null);

  gate.set('video-2');
  await settle();
  assert.equal(attached, 'video-2');
  assert.equal(gate.current(), 'video-2');
});

// ---------------------------------------------------------------- D

test('scanning view shows a centred horizontal scan frame and no torch button without torch', async () => {
  const { ScannerView } = await load(`${FEATURE}/ScannerView.tsx`);

  const html = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'scanning',
      torch: { available: false, on: false },
      onToggleTorch: () => {},
    }),
  );

  assert.match(html, /aria-label="Barcode scan area"/);
  assert.match(html, /left:10%;top:35%;width:80%;height:30%/);
  assert.doesNotMatch(html, /flashlight/i);
});

test('torch button appears only when torch is available and reflects its state', async () => {
  const { ScannerView } = await load(`${FEATURE}/ScannerView.tsx`);

  const off = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'scanning',
      torch: { available: true, on: false },
      onToggleTorch: () => {},
    }),
  );
  assert.match(off, /Turn on flashlight/);

  const on = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'scanning',
      torch: { available: true, on: true },
      onToggleTorch: () => {},
    }),
  );
  assert.match(on, /Turn off flashlight/);
});

test('a confirmed barcode keeps the scan frame on screen while it is looked up', async () => {
  const { ScannerView } = await load(`${FEATURE}/ScannerView.tsx`);

  const html = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'decoded',
      torch: { available: true, on: true },
      onToggleTorch: () => {},
    }),
  );

  assert.match(html, /aria-label="Barcode scan area"/);
  // The camera is released after a decode, so there is no torch to control.
  assert.doesNotMatch(html, /flashlight/i);
});

test('interrupted view says the camera stopped and offers a retry instead of a scan frame', async () => {
  const { ScannerView } = await load(`${FEATURE}/ScannerView.tsx`);

  const html = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'interrupted',
      torch: { available: false, on: false },
      onToggleTorch: () => {},
      onRetry: () => {},
    }),
  );

  assert.match(html, /camera stopped/i);
  assert.match(html, />Try again</);
  assert.doesNotMatch(html, /aria-label="Barcode scan area"/);
});

test('permission-denied view explains how to allow the camera instead of a scan frame', async () => {
  const { ScannerView } = await load(`${FEATURE}/ScannerView.tsx`);

  const html = renderToStaticMarkup(
    React.createElement(ScannerView, {
      status: 'permission-denied',
      torch: { available: false, on: false },
      onToggleTorch: () => {},
    }),
  );

  assert.match(html, /camera permission/i);
  assert.doesNotMatch(html, /aria-label="Barcode scan area"/);
});
