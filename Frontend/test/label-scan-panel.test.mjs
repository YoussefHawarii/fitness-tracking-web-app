import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// The label-scan panel mounted in a DOM with a fake session engine: the
// worker and the review photo are released when the form unmounts (which
// is what happens after the product is created), cancel closes scanning,
// a failed load offers "Try again", review choices start fresh on every
// retake, and a chosen photo is shown with a crop box so the user reads
// either the selected area or the whole photo.

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  pretendToBeVisual: true,
});
for (const key of [
  'window',
  'document',
  'HTMLElement',
  'HTMLInputElement',
  'Node',
  'Event',
  'MouseEvent',
  'MutationObserver',
]) {
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];
}
// jsdom has no PointerEvent and no pointer capture. React dispatches
// onPointerDown/Move/Up by the native event's type, so a MouseEvent
// subclass carrying the pointer fields is enough; capture is a no-op, and
// the tests send every move and up to the element the drag started on, as
// capture would in a browser.
class PointerEvent extends dom.window.MouseEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.pointerType = init.pointerType ?? 'touch';
    this.isPrimary = init.isPrimary ?? true;
  }
}
dom.window.PointerEvent = PointerEvent;
globalThis.PointerEvent = PointerEvent;
// Capture is recorded but not enforced: the tests send every move and up to
// the element the drag started on, as capture would in a browser.
const captured = new WeakMap();
Object.assign(dom.window.Element.prototype, {
  setPointerCapture(id) {
    if (!captured.has(this)) captured.set(this, new Set());
    captured.get(this).add(id);
  },
  releasePointerCapture(id) {
    captured.get(this)?.delete(id);
  },
  hasPointerCapture(id) {
    return captured.get(this)?.has(id) ?? false;
  },
});
if (!('navigator' in globalThis)) {
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let vite;
let React;
let act;
let createRoot;
let panelModule;
let sessionModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  [panelModule, sessionModule] = await Promise.all([
    vite.ssrLoadModule('/src/features/label-scan/LabelScanPanel.tsx'),
    vite.ssrLoadModule('/src/features/label-scan/labelScanSession.ts'),
  ]);
});

after(async () => {
  await vite.close();
  dom.window.close();
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
    word('Energy', 10, 80),
    word('352', 160, 80),
    word('kcal', 200, 80),
    word('Protein', 10, 120),
    word('21', 160, 120),
    word('g', 185, 120),
    word('Carbohydrate', 10, 160),
    word('40', 160, 160),
    word('g', 185, 160),
    word('Fat', 10, 200),
    word('12', 160, 200),
    word('g', 185, 200),
  ],
};

function fakeSession() {
  const engines = [];
  const released = [];
  // The crop (as fractions of the photo) every preparation was asked for;
  // undefined for a whole photo.
  const prepared = [];
  let shown = 0;
  const session = sessionModule.createLabelScanSession({
    createEngine() {
      const load = deferred();
      const engine = {
        terminated: 0,
        // The options of every recognition, in order.
        recognized: [],
        recognize: async (_image, options) => {
          engine.recognized.push(options);
          return LAYOUT;
        },
        async terminate() {
          engine.terminated += 1;
        },
      };
      engines.push({ load, engine });
      return load.promise.then(() => engine);
    },
    prepareImage: async (photo, crop) => {
      prepared.push(crop);
      return photo;
    },
    showImage: async () => ({
      url: `blob:review-${shown++}`,
      width: 1000,
      height: 600,
    }),
    releaseImage: (url) => released.push(url),
  });
  return { session, engines, released, prepared };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function mount(session, Camera) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(panelModule.LabelScanPanel, {
        preview: () => ({ values: {}, conflicts: [], missingRequired: [] }),
        onApply: () => 'Applied',
        createSession: () => session,
        ...(Camera && { Camera }),
      }),
    );
  });
  return { container, root };
}

function button(container, text) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  );
}

async function click(element) {
  assert.ok(element, 'the element to click is shown');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function openAndCrop(fake, container) {
  await click(button(container, 'Scan nutrition label'));
  await settle();
  fake.engines[0].load.resolve();
  await settle();
  await act(async () => {
    await fake.session.scan('photo');
  });
}

async function openAndReview(fake, container) {
  await openAndCrop(fake, container);
  await click(button(container, 'Read whole photo'));
  await settle();
}

test('unmounting the form terminates the worker and releases the review photo', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndReview(fake, container);
  assert.match(container.textContent, /Apply selected/);

  await act(async () => root.unmount());
  await settle();
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.deepEqual(fake.released, ['blob:review-0']);
});

test('cancel closes scanning and terminates the worker', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndReview(fake, container);
  await click(button(container, 'Close scanner'));
  await settle();
  assert.ok(button(container, 'Scan nutrition label'));
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.deepEqual(fake.released, ['blob:review-0']);
  await act(async () => root.unmount());
});

test('a failed engine load offers "Try again", which loads it again', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await click(button(container, 'Scan nutrition label'));
  await settle();
  fake.engines[0].load.reject(new Error('offline'));
  await settle();
  assert.match(container.textContent, /The label scanner couldn’t be loaded/);
  await click(button(container, 'Try again'));
  await settle();
  assert.equal(fake.engines.length, 2);
  assert.match(container.textContent, /Preparing scanner… first time only/);
  await act(async () => root.unmount());
});

test('review choices start fresh on every retake', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndReview(fake, container);

  const proteinBox = () =>
    container.querySelector('input[aria-label="Apply Protein"]');
  assert.equal(proteinBox().checked, true);
  await click(proteinBox());
  assert.equal(proteinBox().checked, false);

  await act(async () => {
    await fake.session.scan('retake');
  });
  await click(button(container, 'Read whole photo'));
  await settle();
  assert.equal(proteinBox().checked, true);
  // The earlier review photo was released when the retake started.
  assert.deepEqual(fake.released, ['blob:review-0']);
  await act(async () => root.unmount());
});

test('Apply is disabled once nothing is selected', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndReview(fake, container);
  for (const box of container.querySelectorAll('input[type="checkbox"]')) {
    if (box.checked) await click(box);
  }
  assert.equal(button(container, 'Apply selected').disabled, true);
  await act(async () => root.unmount());
});

// --- The crop step ---

// The prepared photo is 1000 × 600 (see fakeSession). jsdom has no layout,
// so every element is measured as the photo's displayed box: `width` ×
// `height` CSS pixels whose top-left corner sits at (20, 10) in the
// viewport. Whatever element the panel measures, a drag of d CSS pixels
// is d × 1000 / width photo pixels.
const DISPLAY_LEFT = 20;
const DISPLAY_TOP = 10;

// Only the photo's frame -- the element showing the photo, or an ancestor
// of it that doesn't also hold the read buttons -- is measured as the
// displayed photo. Every other element (the crop box, its handles, the
// panel) measures as a decoy box, so a panel that measures the wrong
// element fails here as it would on a phone.
const DECOY = { left: 3, top: 4, width: 137, height: 59 };

function isPhotoFrame(el) {
  const doc = el.ownerDocument;
  const photo = [...doc.querySelectorAll('[src], [style]')].find((e) =>
    /blob:review-/.test(
      (e.getAttribute('src') ?? '') + (e.getAttribute('style') ?? ''),
    ),
  );
  if (!photo || !el.contains(photo)) return false;
  return ![...el.querySelectorAll('button')].some((b) =>
    /^Read (selected area|whole photo)$/.test(b.textContent),
  );
}

function displayAt(width, height) {
  const proto = dom.window.Element.prototype;
  const htmlProto = dom.window.HTMLElement.prototype;
  const saved = [];
  const box = (el) =>
    isPhotoFrame(el)
      ? { left: DISPLAY_LEFT, top: DISPLAY_TOP, width, height }
      : DECOY;
  const sized = {
    clientWidth: (el) => box(el).width,
    clientHeight: (el) => box(el).height,
    offsetWidth: (el) => box(el).width,
    offsetHeight: (el) => box(el).height,
  };
  for (const [name, measure] of Object.entries(sized)) {
    for (const target of [proto, htmlProto]) {
      saved.push([target, name, Object.getOwnPropertyDescriptor(target, name)]);
      Object.defineProperty(target, name, {
        configurable: true,
        get() {
          return measure(this);
        },
      });
    }
  }
  saved.push([
    proto,
    'getBoundingClientRect',
    Object.getOwnPropertyDescriptor(proto, 'getBoundingClientRect'),
  ]);
  Object.defineProperty(proto, 'getBoundingClientRect', {
    configurable: true,
    writable: true,
    value() {
      const { left, top, width: w, height: h } = box(this);
      return {
        left,
        top,
        right: left + w,
        bottom: top + h,
        x: left,
        y: top,
        width: w,
        height: h,
        toJSON() {},
      };
    },
  });
  return () => {
    for (const [target, name, descriptor] of saved.reverse()) {
      if (descriptor) Object.defineProperty(target, name, descriptor);
      else delete target[name];
    }
  };
}

// A region in the prepared photo's pixels as the fractions of the photo the
// session asks for the crop (the prepared photo is 1000 × 600).
function cropOf(left, top, width, height) {
  return {
    left: left / 1000,
    top: top / 600,
    width: width / 1000,
    height: height / 600,
  };
}

function labelled(container, pattern) {
  return [...container.querySelectorAll('[aria-label]')].filter((el) =>
    pattern.test(el.getAttribute('aria-label')),
  );
}

// The crop box: the element labelled as the crop area (not a handle).
function cropBox(container) {
  const [box] = labelled(container, /crop/i).filter(
    (el) => !/resize/i.test(el.getAttribute('aria-label')),
  );
  return box;
}

// The handle that resizes from the bottom-right corner: the only resize
// handle, or the one labelled bottom right.
function cornerHandle(container) {
  const handles = labelled(container, /resize/i);
  return handles.length === 1
    ? handles[0]
    : handles.find((el) =>
        /bottom.?right/i.test(el.getAttribute('aria-label')),
      );
}

function pointer(element, type, clientX, clientY) {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
    }),
  );
}

// Drags from one viewport point to another in a few steps, as a finger
// would.
async function drag(element, [fromX, fromY], [toX, toY]) {
  assert.ok(element, 'the element to drag is shown');
  await act(async () => pointer(element, 'pointerdown', fromX, fromY));
  for (const step of [1, 2, 3]) {
    await act(async () =>
      pointer(
        element,
        'pointermove',
        fromX + ((toX - fromX) * step) / 3,
        fromY + ((toY - fromY) * step) / 3,
      ),
    );
  }
  await act(async () => pointer(element, 'pointerup', toX, toY));
}

test('a chosen photo is shown with a crop box and both read buttons, before anything is read', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndCrop(fake, container);
  await settle();

  assert.ok(
    container.innerHTML.includes('blob:review-0'),
    'the chosen photo is shown',
  );
  assert.ok(cropBox(container), 'a crop box is shown');
  assert.ok(button(container, 'Read selected area'));
  assert.ok(button(container, 'Read whole photo'));
  assert.deepEqual(fake.engines[0].engine.recognized, []);
  assert.doesNotMatch(container.textContent, /Apply selected/);
  await act(async () => root.unmount());
});

test('"Read whole photo" reads the whole photo and shows the review', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndCrop(fake, container);
  await click(button(container, 'Read whole photo'));
  await settle();
  assert.deepEqual(fake.engines[0].engine.recognized, [undefined]);
  assert.match(container.textContent, /Apply selected/);
  await act(async () => root.unmount());
});

test('"Read selected area" with the default box reads the whole photo as a region', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  const restore = displayAt(500, 300);
  try {
    await openAndCrop(fake, container);
    await click(button(container, 'Read selected area'));
    await settle();
    // The area is cut from the original photo (not a region of the scaled
    // copy) and read as one block.
    assert.deepEqual(fake.prepared, [undefined, cropOf(0, 0, 1000, 600)]);
    assert.deepEqual(fake.engines[0].engine.recognized, [{ layout: 'block' }]);
    assert.match(container.textContent, /Apply selected/);
  } finally {
    restore();
    await act(async () => root.unmount());
  }
});

for (const [width, height] of [
  [500, 300],
  [250, 150],
]) {
  test(`resizing and moving the crop box changes the region read, in photo pixels (shown at ${width}×${height})`, async () => {
    const fake = fakeSession();
    const { container, root } = await mount(fake.session);
    const restore = displayAt(width, height);
    // CSS pixels per photo pixel.
    const k = width / 1000;
    const at = (x, y) => [DISPLAY_LEFT + x * k, DISPLAY_TOP + y * k];
    try {
      await openAndCrop(fake, container);
      const handle = cornerHandle(container);
      assert.ok(handle, 'the crop box has a corner resize handle');

      // Bottom-right corner from (1000, 600) to (500, 300): the box is now
      // the top-left quarter of the photo.
      await drag(handle, at(1000, 600), at(500, 300));
      // Then move it by (200, 100), grabbing it inside.
      await drag(cropBox(container), at(250, 150), at(450, 250));

      await click(button(container, 'Read selected area'));
      await settle();
      assert.deepEqual(fake.prepared, [undefined, cropOf(200, 100, 500, 300)]);
      assert.deepEqual(fake.engines[0].engine.recognized, [
        { layout: 'block' },
      ]);
    } finally {
      restore();
      await act(async () => root.unmount());
    }
  });
}

test('the crop box cannot be moved off the photo', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  const restore = displayAt(500, 300);
  const at = (x, y) => [DISPLAY_LEFT + x / 2, DISPLAY_TOP + y / 2];
  try {
    await openAndCrop(fake, container);
    await drag(cornerHandle(container), at(1000, 600), at(500, 300));
    // Dragged far past the bottom-right edge: it stops at the edge.
    await drag(cropBox(container), at(250, 150), at(2250, 1150));
    await click(button(container, 'Read selected area'));
    await settle();
    assert.deepEqual(fake.prepared, [undefined, cropOf(500, 300, 500, 300)]);
  } finally {
    restore();
    await act(async () => root.unmount());
  }
});

test('choosing another photo while cropping shows the new photo and releases the old one', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndCrop(fake, container);
  assert.match(container.textContent, /take photo/i);
  assert.match(container.textContent, /choose (another )?photo/i);

  const input = container.querySelector('input[type="file"]:not([capture])');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new dom.window.Blob(['another'])],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();

  assert.deepEqual(fake.released, ['blob:review-0']);
  assert.ok(container.innerHTML.includes('blob:review-1'));
  assert.ok(button(container, 'Read whole photo'));
  assert.deepEqual(fake.engines[0].engine.recognized, []);
  await act(async () => root.unmount());
});

test('cancel while cropping closes scanning, releases the photo and reads nothing', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndCrop(fake, container);
  const cancel =
    button(container, 'Cancel') ?? button(container, 'Close scanner');
  await click(cancel);
  await settle();
  assert.ok(button(container, 'Scan nutrition label'));
  assert.equal(fake.engines[0].engine.terminated, 1);
  assert.deepEqual(fake.released, ['blob:review-0']);
  assert.deepEqual(fake.engines[0].engine.recognized, []);
  await act(async () => root.unmount());
});

test('the privacy note is shown while cropping', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  await openAndCrop(fake, container);
  assert.ok(
    button(container, 'Read whole photo'),
    'the photo is shown for cropping',
  );
  assert.ok(
    container.textContent.includes(sessionModule.LABEL_SCAN_PRIVACY_NOTE),
  );
  await act(async () => root.unmount());
});

test('the crop box cannot be resized past the photo or collapsed', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  const restore = displayAt(500, 300);
  const at = (x, y) => [DISPLAY_LEFT + x / 2, DISPLAY_TOP + y / 2];
  try {
    await openAndCrop(fake, container);
    // The top-left quarter, moved to (250, 150): the corner sits at
    // (750, 450), with 250 × 150 photo pixels to spare.
    await drag(cornerHandle(container), at(1000, 600), at(500, 300));
    await drag(cropBox(container), at(250, 150), at(500, 300));
    // Dragged far past the bottom-right edge: it stops at the edge.
    await drag(cornerHandle(container), at(750, 450), at(3000, 3000));
    await click(button(container, 'Read selected area'));
    await settle();
    assert.deepEqual(fake.prepared, [undefined, cropOf(250, 150, 750, 450)]);
  } finally {
    restore();
    await act(async () => root.unmount());
  }
});

test('the crop box keeps a usable size when its corner is dragged past its opposite corner', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  const restore = displayAt(500, 300);
  const at = (x, y) => [DISPLAY_LEFT + x / 2, DISPLAY_TOP + y / 2];
  try {
    await openAndCrop(fake, container);
    await drag(cornerHandle(container), at(1000, 600), at(-2000, -2000));
    await click(button(container, 'Read selected area'));
    await settle();
    const [, crop] = fake.prepared;
    assert.equal(crop.left, 0);
    assert.equal(crop.top, 0);
    const [width, height] = [crop.width * 1000, crop.height * 600];
    assert.ok(width >= 1 && width <= 1000, `width ${width}`);
    assert.ok(height >= 1 && height <= 600, `height ${height}`);
  } finally {
    restore();
    await act(async () => root.unmount());
  }
});

test('a new photo starts with the crop box over the whole photo', async () => {
  const fake = fakeSession();
  const { container, root } = await mount(fake.session);
  const restore = displayAt(500, 300);
  const at = (x, y) => [DISPLAY_LEFT + x / 2, DISPLAY_TOP + y / 2];
  try {
    await openAndCrop(fake, container);
    await drag(cornerHandle(container), at(1000, 600), at(500, 300));
    await act(async () => {
      await fake.session.scan('another photo');
    });
    await click(button(container, 'Read selected area'));
    await settle();
    assert.deepEqual(fake.prepared.at(-1), cropOf(0, 0, 1000, 600));
  } finally {
    restore();
    await act(async () => root.unmount());
  }
});

// --- The label camera ---

// A stand-in for the framed camera, so the panel is tested without a real
// one: it counts how often it is mounted and unmounted, takes a photo when
// asked, and reports a problem on demand (camera.reportProblem).
const FRAMED_PHOTO = 'framed photo';

function fakeCamera() {
  const camera = { mounted: 0, unmounted: 0, props: null };
  camera.reportProblem = (problem) =>
    act(async () => camera.props.onProblemChange(problem));
  camera.Component = function FakeCamera(props) {
    const { onCapture, onClose } = props;
    camera.props = props;
    React.useEffect(() => {
      camera.mounted += 1;
      return () => {
        camera.unmounted += 1;
      };
    }, []);
    return React.createElement(
      'div',
      { 'data-testid': 'camera' },
      React.createElement(
        'button',
        { type: 'button', onClick: () => onCapture(FRAMED_PHOTO) },
        'Take label photo',
      ),
      React.createElement(
        'button',
        { type: 'button', onClick: onClose },
        'Close camera',
      ),
    );
  };
  camera.shown = (container) =>
    container.querySelector('[data-testid="camera"]') !== null;
  return camera;
}

async function openScanner(fake, container) {
  await click(button(container, 'Scan nutrition label'));
  await settle();
  fake.engines[0].load.resolve();
  await settle();
}

const fileButtonsShown = (container) =>
  /Take photo|Choose photo/.test(container.textContent) &&
  container.querySelectorAll('input[type="file"]').length > 0;

test('"Scan with camera" opens the camera and hides the file buttons', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openScanner(fake, container);
  assert.ok(fileButtonsShown(container));
  assert.equal(camera.shown(container), false);

  await click(button(container, 'Scan with camera'));
  assert.equal(camera.shown(container), true);
  assert.equal(fileButtonsShown(container), false);
  assert.equal(button(container, 'Scan with camera'), undefined);
  // The scanner can still be closed from here.
  assert.ok(button(container, 'Close scanner'));
  await act(async () => root.unmount());
});

test('a photo taken with the camera closes it and is read as one block, with no crop step', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openScanner(fake, container);
  await click(button(container, 'Scan with camera'));

  await click(button(container, 'Take label photo'));
  await settle();

  assert.equal(camera.shown(container), false);
  assert.equal(camera.unmounted, 1);
  // The framed photo is already cut to the frame: prepared whole, then
  // read as a block straight away.
  assert.deepEqual(fake.prepared, [undefined]);
  assert.deepEqual(fake.engines[0].engine.recognized, [{ layout: 'block' }]);
  assert.equal(button(container, 'Read selected area'), undefined);
  assert.equal(button(container, 'Read whole photo'), undefined);
  assert.match(container.textContent, /Apply selected/);
  assert.ok(button(container, 'Scan again with camera'));
  await act(async () => root.unmount());
});

test('"Close camera" returns to the photo buttons without reading anything', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openScanner(fake, container);
  await click(button(container, 'Scan with camera'));

  await click(button(container, 'Close camera'));
  assert.equal(camera.shown(container), false);
  assert.equal(camera.unmounted, 1);
  assert.ok(button(container, 'Scan with camera'));
  assert.ok(fileButtonsShown(container));
  // The scanner itself is still open.
  assert.ok(button(container, 'Close scanner'));
  assert.deepEqual(fake.prepared, []);
  assert.deepEqual(fake.engines[0].engine.recognized, []);
  await act(async () => root.unmount());
});

test('"Close scanner" while the camera is open closes the camera and the scanner', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openScanner(fake, container);
  await click(button(container, 'Scan with camera'));

  await click(button(container, 'Close scanner'));
  await settle();
  assert.equal(camera.shown(container), false);
  assert.equal(camera.unmounted, 1);
  assert.ok(button(container, 'Scan nutrition label'));
  assert.equal(fake.engines[0].engine.terminated, 1);

  // Opening the scanner again starts with the photo buttons, not a camera.
  await click(button(container, 'Scan nutrition label'));
  assert.equal(camera.shown(container), false);
  assert.ok(button(container, 'Scan with camera'));
  await act(async () => root.unmount());
});

test('the review is hidden while the camera is open and comes back when it is closed', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openAndReview(fake, container);
  assert.match(container.textContent, /Apply selected/);

  await click(button(container, 'Scan again with camera'));
  assert.equal(camera.shown(container), true);
  assert.doesNotMatch(container.textContent, /Apply selected/);

  await click(button(container, 'Close camera'));
  assert.match(container.textContent, /Apply selected/);
  await act(async () => root.unmount());
});

test('a photo taken with the camera replaces the earlier review and releases its photo', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openAndReview(fake, container);

  await click(button(container, 'Scan again with camera'));
  await click(button(container, 'Take label photo'));
  await settle();

  assert.deepEqual(fake.released, ['blob:review-0']);
  assert.ok(container.innerHTML.includes('blob:review-1'));
  assert.match(container.textContent, /Apply selected/);
  await act(async () => root.unmount());
});

test('while the camera shows a problem, "Take photo" and "Choose photo" are offered', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openScanner(fake, container);
  await click(button(container, 'Scan with camera'));
  assert.equal(fileButtonsShown(container), false);

  await camera.reportProblem(true);
  assert.equal(camera.shown(container), true);
  assert.ok(fileButtonsShown(container));
  assert.match(container.textContent, /Take photo/);
  assert.match(container.textContent, /Choose photo/);
  // The camera itself is retried or closed from its own buttons.
  assert.equal(button(container, 'Scan with camera'), undefined);
  assert.ok(button(container, 'Close camera'));

  // The problem clears (a retry worked): the photo buttons go away again.
  await camera.reportProblem(false);
  assert.equal(fileButtonsShown(container), false);
  await act(async () => root.unmount());
});

test('choosing a photo while the camera shows a problem closes it and goes to the crop step', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openScanner(fake, container);
  await click(button(container, 'Scan with camera'));
  await camera.reportProblem(true);

  const input = container.querySelector('input[type="file"]:not([capture])');
  Object.defineProperty(input, 'files', {
    configurable: true,
    value: [new dom.window.Blob(['chosen'])],
  });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle();

  assert.equal(camera.shown(container), false);
  assert.equal(camera.unmounted, 1);
  assert.ok(button(container, 'Read whole photo'));
  assert.deepEqual(fake.engines[0].engine.recognized, []);
  await act(async () => root.unmount());
});

test('a problem from an earlier camera does not show the photo buttons on the next one', async () => {
  const fake = fakeSession();
  const camera = fakeCamera();
  const { container, root } = await mount(fake.session, camera.Component);
  await openScanner(fake, container);
  await click(button(container, 'Scan with camera'));
  await camera.reportProblem(true);
  await click(button(container, 'Close camera'));

  await click(button(container, 'Scan with camera'));
  assert.equal(camera.shown(container), true);
  assert.equal(fileButtonsShown(container), false);
  await act(async () => root.unmount());
});
