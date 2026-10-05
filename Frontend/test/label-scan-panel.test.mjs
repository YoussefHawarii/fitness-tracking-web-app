import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// The label-scan panel mounted in a DOM with a fake session engine: the
// worker and the review photo are released when the form unmounts (which
// is what happens after the product is created), cancel closes scanning,
// a failed load offers "Try again", and review choices start fresh on
// every retake.

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
  let shown = 0;
  const session = sessionModule.createLabelScanSession({
    createEngine() {
      const load = deferred();
      const engine = {
        terminated: 0,
        recognize: async () => LAYOUT,
        async terminate() {
          engine.terminated += 1;
        },
      };
      engines.push({ load, engine });
      return load.promise.then(() => engine);
    },
    prepareImage: async (photo) => photo,
    showImage: async () => ({
      url: `blob:review-${shown++}`,
      width: 1000,
      height: 600,
    }),
    releaseImage: (url) => released.push(url),
  });
  return { session, engines, released };
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function mount(session) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(panelModule.LabelScanPanel, {
        preview: () => ({ values: {}, conflicts: [], missingRequired: [] }),
        onApply: () => 'Applied',
        createSession: () => session,
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
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function openAndReview(fake, container) {
  await click(button(container, 'Scan nutrition label'));
  await settle();
  fake.engines[0].load.resolve();
  await settle();
  await act(async () => {
    await fake.session.scan('photo');
  });
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
