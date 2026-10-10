import assert from 'node:assert/strict';
import { after, before, test as baseTest } from 'node:test';
import { createServer } from 'vite';

// A regressed run fails fast instead of hanging `npm test`.
const test = (name, fn) => baseTest(name, { timeout: 5000 }, fn);

// The cleanup of a photo (labelCleanup.ts) runs in a Web Worker so the page
// doesn't freeze (cleanupRunner.ts). Node has no Worker, so these tests give
// it a recording stand-in and check how the photo's pixels are handed over,
// that the worker is thrown away after its job, and that the cleanup still
// happens on the main thread where no worker can be started.

let vite;
let runner;
let cleanup;

before(async () => {
  vite = await createServer({
    root: process.cwd(),
    appType: 'custom',
    server: { middlewareMode: true },
  });
  [runner, cleanup] = await Promise.all([
    vite.ssrLoadModule('/src/features/label-scan/cleanupRunner.ts'),
    vite.ssrLoadModule('/src/features/label-scan/labelCleanup.ts'),
  ]);
});

after(async () => {
  await vite.close();
});

function photo() {
  const data = new Uint8Array(120 * 80).fill(220);
  return { width: 120, height: 80, data };
}

// Runs `body` with a global Worker (or none) and puts the global back.
async function withWorker(WorkerClass, body) {
  const saved = globalThis.Worker;
  if (WorkerClass) globalThis.Worker = WorkerClass;
  else delete globalThis.Worker;
  try {
    return await body();
  } finally {
    runner.forgetCleanupWorkerFailure();
    if (saved) globalThis.Worker = saved;
    else delete globalThis.Worker;
  }
}

test('where there is no Worker the cleanup runs on this thread and leaves the photo intact', async () => {
  const img = photo();
  const cleaned = await withWorker(undefined, () => runner.cleanOffThread(img));
  assert.equal(cleaned.hasGrid, false);
  assert.equal(cleaned.image.width, 240);
  assert.equal(img.data.byteLength, 120 * 80);
});

test('a Worker that cannot be created falls back to this thread', async () => {
  class Refusing {
    constructor() {
      throw new Error('blocked');
    }
  }
  const img = photo();
  const cleaned = await withWorker(Refusing, () => runner.cleanOffThread(img));
  assert.equal(cleaned.image.width, 240);
  assert.equal(img.data.byteLength, 120 * 80);
});

// A Worker stand-in: records how it is made and used, and answers with
// `reply` (given the request) once the photo is posted.
function recordingWorker(reply) {
  const log = { made: [], posted: [], terminated: 0 };
  class Recording {
    constructor(url, options) {
      log.made.push({ url: String(url), options });
    }
    postMessage(message, transfer) {
      log.posted.push({ message, transfer });
      queueMicrotask(() => reply(this, message));
    }
    terminate() {
      log.terminated += 1;
    }
  }
  return { Recording, log };
}

test('the photo goes to a module worker with its buffer transferred, and the cleaned copy comes back', async () => {
  const img = photo();
  const expected = cleanup.cleanForRecognition(photo());
  const { Recording, log } = recordingWorker((worker) =>
    worker.onmessage({ data: { cleaned: expected } }),
  );
  const region = { left: 5, top: 5, width: 50, height: 40 };
  const cleaned = await withWorker(Recording, () =>
    runner.cleanOffThread(img, region),
  );

  assert.strictEqual(cleaned, expected);
  assert.equal(log.made.length, 1);
  assert.match(log.made[0].url, /labelCleanup\.worker\.ts/);
  assert.deepEqual(log.made[0].options, { type: 'module' });
  assert.equal(log.posted.length, 1);
  assert.strictEqual(log.posted[0].message.photo, img);
  assert.deepEqual(log.posted[0].message.region, region);
  assert.deepEqual(log.posted[0].transfer, [img.data.buffer]);
  // The worker is thrown away after its one job, releasing what it held.
  assert.equal(log.terminated, 1);
});

test('a worker that dies after taking the photo rejects as dead, and is thrown away', async () => {
  const { Recording, log } = recordingWorker((worker) => worker.onerror({}));
  await withWorker(Recording, async () => {
    await assert.rejects(
      runner.cleanOffThread(photo()),
      runner.CleanupWorkerDied,
    );
  });
  assert.equal(log.terminated, 1);
});

test('an unreadable message from the worker counts as the worker dying', async () => {
  const { Recording, log } = recordingWorker((worker) =>
    worker.onmessageerror({}),
  );
  await withWorker(Recording, async () => {
    await assert.rejects(
      runner.cleanOffThread(photo()),
      runner.CleanupWorkerDied,
    );
  });
  assert.equal(log.terminated, 1);
});

test('a worker that never answers is given up on and thrown away', async () => {
  const { Recording, log } = recordingWorker(() => {});
  const impatient = runner.createOffThreadCleaner(20);
  await withWorker(Recording, async () => {
    await assert.rejects(impatient(photo()), runner.CleanupWorkerDied);
  });
  assert.equal(log.terminated, 1);
});

test('a timeout is not held against later cleanups: the next one still tries a worker', async () => {
  const { Recording, log } = recordingWorker(() => {});
  const impatient = runner.createOffThreadCleaner(20);
  await withWorker(Recording, async () => {
    await assert.rejects(impatient(photo()), runner.CleanupWorkerDied);
    await assert.rejects(impatient(photo()), runner.CleanupWorkerDied);
  });
  assert.equal(log.made.length, 2);
});

test('after a worker has died, later cleanups skip workers and run on this thread', async () => {
  const dying = recordingWorker((worker) => worker.onerror({}));
  await withWorker(dying.Recording, async () => {
    await assert.rejects(runner.cleanOffThread(photo()));
    const img = photo();
    const cleaned = await runner.cleanOffThread(img);
    assert.equal(cleaned.image.width, 240);
    // No second worker was made, and the photo was not transferred.
    assert.equal(dying.log.made.length, 1);
    assert.equal(img.data.byteLength, 120 * 80);
  });
});

test('a worker that reports the cleanup threw is not a dead worker', async () => {
  const { Recording, log } = recordingWorker((worker) =>
    worker.onmessage({ data: { failed: true } }),
  );
  await withWorker(Recording, async () => {
    const error = await runner.cleanOffThread(photo()).then(
      () => undefined,
      (e) => e,
    );
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof runner.CleanupWorkerDied));
    // And the next photo still goes to a worker.
    await runner.cleanOffThread(photo()).catch(() => undefined);
  });
  assert.equal(log.terminated, 2);
  assert.equal(log.made.length, 2);
});

test('aborting stops a cleanup in its worker and throws the worker away', async () => {
  const { Recording, log } = recordingWorker(() => {});
  const controller = new AbortController();
  await withWorker(Recording, async () => {
    const running = runner.cleanOffThread(
      photo(),
      undefined,
      controller.signal,
    );
    controller.abort();
    await assert.rejects(running, { name: 'AbortError' });
  });
  assert.equal(log.terminated, 1);
});

test('the worker module cleans a posted photo and sends back buffers it hands over', async () => {
  const sent = [];
  const fakeSelf = {
    postMessage: (message, transfer) => sent.push({ message, transfer }),
  };
  const saved = globalThis.self;
  globalThis.self = fakeSelf;
  try {
    await vite.ssrLoadModule('/src/features/label-scan/labelCleanup.worker.ts');
  } finally {
    globalThis.self = saved;
  }
  fakeSelf.onmessage({ data: { photo: photo() } });
  assert.equal(sent.length, 1);
  const { cleaned } = sent[0].message;
  assert.equal(cleaned.image.width, 240);
  assert.deepEqual(sent[0].transfer, cleanup.transferablesOf(cleaned));

  // A photo it cannot clean is reported, not thrown.
  fakeSelf.onmessage({ data: { photo: null } });
  assert.deepEqual(sent[1].message, { failed: true });
});
