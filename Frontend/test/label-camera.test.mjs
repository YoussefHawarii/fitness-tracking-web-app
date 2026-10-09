import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// The label camera mounted in a DOM with a fake camera at the getUserMedia
// boundary: the frame toggle and the flashlight say what state they are in
// to a screen reader, and a camera problem is announced with wording that
// fits a single photo (nothing to "resume"), and a photo that can't be taken
// says so.

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
// jsdom does not implement media playback.
dom.window.HTMLMediaElement.prototype.play = () => Promise.resolve();
dom.window.HTMLMediaElement.prototype.pause = () => {};

let vite;
let React;
let act;
let createRoot;
let cameraModule;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  React = await import('react');
  act = React.act;
  ({ createRoot } = await import('react-dom/client'));
  cameraModule = await vite.ssrLoadModule(
    '/src/features/label-scan/LabelCamera.tsx',
  );
});

after(async () => {
  await vite.close();
  dom.window.close();
});

const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });

// A rear camera with a flashlight whose track can be ended like the OS
// does, a getUserMedia that fails with the given error name, or one that
// never settles (a permission prompt nobody has answered).
function useFakeCamera({ failWith, pending } = {}) {
  const track = Object.assign(new dom.window.EventTarget(), {
    getCapabilities: () => ({ torch: true }),
    applyConstraints: async () => {},
    stop() {},
  });
  const stream = {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  };
  Object.defineProperty(dom.window.navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: async () => {
        if (pending) return new Promise(() => {});
        if (failWith) throw new DOMException('no', failWith);
        return stream;
      },
    },
  });
  return { track };
}

async function mount(props = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(cameraModule.LabelCamera, {
        onCapture: () => {},
        onClose: () => {},
        ...props,
      }),
    );
  });
  await settle();
  return { container, root };
}

const byName = (container, name) =>
  [...container.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === name || b.textContent === name,
  );

async function click(element) {
  assert.ok(element, 'the element to click is shown');
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

test('the frame toggle keeps one name and says whether the wide frame is on', async () => {
  useFakeCamera();
  const { container, root } = await mount();

  const toggle = byName(container, 'Wide table frame');
  assert.ok(toggle);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.ok(container.querySelector('[aria-label="Tall label frame"]'));

  await click(toggle);
  assert.equal(toggle.textContent, 'Wide table frame');
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.ok(container.querySelector('[aria-label="Wide label frame"]'));

  await click(toggle);
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  await act(async () => root.unmount());
});

test('the flashlight button keeps one name and says whether it is on', async () => {
  useFakeCamera();
  const { container, root } = await mount();

  const torch = byName(container, 'Flashlight');
  assert.ok(torch);
  assert.equal(torch.hasAttribute('aria-label'), false);
  assert.equal(torch.getAttribute('aria-pressed'), 'false');

  await click(torch);
  await settle();
  assert.equal(torch.textContent, 'Flashlight');
  assert.equal(torch.getAttribute('aria-pressed'), 'true');
  await act(async () => root.unmount());
});

test('a denied camera is announced as an alert and reported as a problem', async () => {
  useFakeCamera({ failWith: 'NotAllowedError' });
  const reported = [];
  const { container, root } = await mount({
    onLiveChange: (live) => reported.push(live),
  });

  const alert = container.querySelector('p[role="alert"]');
  assert.ok(alert);
  assert.match(alert.textContent, /permission was denied/i);
  assert.ok(byName(container, 'Try again'));
  assert.ok(byName(container, 'Close camera'));
  assert.equal(reported.at(-1), false);
  await act(async () => root.unmount());
});

test('a camera taken away mid-view says so without talking about resuming a scan', async () => {
  const { track } = useFakeCamera();
  const { container, root } = await mount();
  assert.equal(container.querySelector('[role="alert"]'), null);

  await act(async () => track.dispatchEvent(new dom.window.Event('ended')));
  await settle();

  const alert = container.querySelector('p[role="alert"]');
  assert.ok(alert);
  assert.match(alert.textContent, /camera stopped/i);
  assert.match(alert.textContent, /reopen it/i);
  assert.doesNotMatch(alert.textContent, /resume scanning/i);
  await act(async () => root.unmount());
});

test('a working camera reports that it is live', async () => {
  useFakeCamera();
  const reported = [];
  const { root } = await mount({
    onLiveChange: (live) => reported.push(live),
  });
  assert.equal(reported.at(-1), true);
  await act(async () => root.unmount());
});

test('a camera that is still starting reports that it is not live', async () => {
  useFakeCamera({ pending: true });
  const reported = [];
  const { container, root } = await mount({
    onLiveChange: (live) => reported.push(live),
  });
  assert.ok(reported.length > 0);
  assert.ok(reported.every((live) => live === false));
  assert.match(container.textContent, /Starting camera/);
  assert.equal(byName(container, 'Take label photo').disabled, true);
  await act(async () => root.unmount());
});

test('a photo that cannot be taken says so, and the message clears on the next try', async () => {
  useFakeCamera();
  let captured = 0;
  const { container, root } = await mount({
    onCapture: () => {
      captured += 1;
    },
  });
  assert.equal(container.querySelector('[role="alert"]'), null);

  // jsdom's video never has a frame, so there is nothing to draw.
  await click(byName(container, 'Take label photo'));
  await settle();
  const alert = container.querySelector('p[role="alert"]');
  assert.ok(alert);
  assert.match(alert.textContent, /couldn.t take the photo/i);
  assert.equal(captured, 0);
  assert.equal(byName(container, 'Take label photo').disabled, false);

  // Another try clears the message first; here it fails again, so it returns.
  await click(byName(container, 'Take label photo'));
  await settle();
  assert.equal(container.querySelectorAll('p[role="alert"]').length, 1);
  await act(async () => root.unmount());
});
