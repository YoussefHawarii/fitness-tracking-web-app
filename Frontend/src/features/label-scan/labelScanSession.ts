import { readLabel, type LabelScanResult } from './labelReader';
import type { OcrEngine, OcrProgress } from './ocrEngine';
import type { OcrLayout } from './ocrLayout';
import { LabelImageDecodeError } from './prepareImage';

// The Label-scan session: everything between opening label scanning and
// closing it — loading the on-device engine (with progress and retry),
// preparing each photo, recognition, discarding results of a cancelled or
// replaced run, reusing one worker for every retake, and releasing the
// worker and the review photo. It holds no React state and talks to the
// OCR engine and the image helpers only through the dependencies it is
// given, so its lifecycle is testable with a fake engine.
//
// Nothing here writes to localStorage/sessionStorage or makes a request:
// the only downloads are the engine's own same-origin assets.

export interface ReviewImage {
  url: string;
  width: number;
  height: number;
}

export interface LabelScanDependencies {
  createEngine: (
    onProgress: (progress: OcrProgress) => void,
  ) => Promise<OcrEngine>;
  prepareImage: (file: Blob) => Promise<Blob>;
  // Makes the prepared photo viewable in the review (an object URL).
  showImage: (image: Blob) => Promise<ReviewImage>;
  releaseImage: (url: string) => void;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type ScanStatus =
  | { kind: 'none' }
  | { kind: 'recognizing' }
  | { kind: 'review'; result: LabelScanResult; image: ReviewImage; run: number }
  | { kind: 'error'; message: string };

export interface LabelScanView {
  open: boolean;
  engine: EngineStatus;
  progress: OcrProgress | null;
  scan: ScanStatus;
}

export const ENGINE_LOAD_FAILED_MESSAGE =
  'The label scanner couldn’t be loaded — check your connection and try again.';
export const IMAGE_FORMAT_MESSAGE =
  'This photo format can’t be read here — try “Take photo” or a JPEG/PNG.';
export const IMAGE_FAILED_MESSAGE = 'Could not read this image.';

const STALE = Symbol('stale run');

const CLOSED: LabelScanView = {
  open: false,
  engine: 'idle',
  progress: null,
  scan: { kind: 'none' },
};

export interface LabelScanSession {
  view(): LabelScanView;
  subscribe(listener: () => void): () => void;
  // Opens scanning and starts loading the engine straight away, so it is
  // ready sooner while the user takes the photo.
  open(): void;
  // Loads the engine again after a failed load.
  retry(): void;
  // Reads a photo. A scan started while another runs replaces it: the
  // earlier run's result is discarded when it arrives.
  scan(photo: Blob): Promise<void>;
  // Stops any recognition, terminates the worker and discards the photo
  // and readings. The form is untouched.
  cancel(): void;
  // Releases everything for good (the form is going away).
  dispose(): void;
}

export function createLabelScanSession(
  deps: LabelScanDependencies,
): LabelScanSession {
  let view: LabelScanView = CLOSED;
  const listeners = new Set<() => void>();
  let engine: Promise<OcrEngine> | null = null;
  let run = 0;
  let disposed = false;
  // Termination of the previous worker, which a new one waits for.
  let stopping: Promise<void> = Promise.resolve();
  // Recognitions on the shared worker run one at a time: the engine
  // switches languages and parameters across several steps per photo.
  let recognitions: Promise<unknown> = Promise.resolve();

  function set(next: Partial<LabelScanView>) {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  }

  function releaseReviewImage() {
    if (view.scan.kind === 'review') deps.releaseImage(view.scan.image.url);
  }

  // One worker per scanning session, created on demand and reused. A
  // failed load is forgotten only if it is still the current one, so a
  // late failure never orphans a newer worker.
  function ensureEngine(): Promise<OcrEngine> {
    if (engine) return engine;
    // A new worker is only created once the previous one has terminated,
    // so cancelling during a load and reopening never runs two at once.
    const created: Promise<OcrEngine> = stopping.then(() =>
      deps.createEngine((progress) => {
        if (engine === created) set({ progress });
      }),
    );
    engine = created;
    set({ engine: 'loading', progress: null });
    created.then(
      () => {
        if (engine === created) set({ engine: 'ready', progress: null });
      },
      () => {
        if (engine === created) {
          engine = null;
          set({ engine: 'failed', progress: null });
        }
      },
    );
    return created;
  }

  function stopEngine() {
    const current = engine;
    engine = null;
    if (!current) return;
    const terminated = current
      .then((e) => e.terminate())
      .catch(() => undefined);
    stopping = Promise.all([stopping, terminated]).then(() => undefined);
  }

  return {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    open() {
      if (disposed) return;
      set({ open: true });
      void ensureEngine().catch(() => undefined);
    },
    retry() {
      if (disposed || !view.open) return;
      void ensureEngine().catch(() => undefined);
    },
    async scan(photo) {
      if (disposed) return;
      const thisRun = ++run;
      releaseReviewImage();
      set({ open: true, scan: { kind: 'recognizing' } });
      let image: ReviewImage | undefined;
      try {
        const [prepared, ocr] = await Promise.all([
          deps.prepareImage(photo),
          ensureEngine(),
        ]);
        if (thisRun !== run) return;
        // Queued behind any recognition still running; a run replaced or
        // cancelled while it waited never starts.
        const job = recognitions.then<OcrLayout | typeof STALE>(() =>
          thisRun === run ? ocr.recognize(prepared) : STALE,
        );
        recognitions = job.catch(() => undefined);
        const layout = await job;
        if (layout === STALE || thisRun !== run) return;
        // Parsed before the review photo exists, so a failure can't leave
        // its object URL allocated.
        const result = readLabel(layout);
        image = await deps.showImage(prepared);
        if (thisRun !== run) {
          deps.releaseImage(image.url);
          return;
        }
        set({ scan: { kind: 'review', result, image, run: thisRun } });
      } catch (err) {
        if (thisRun !== run) return;
        set({
          scan: {
            kind: 'error',
            message:
              err instanceof LabelImageDecodeError
                ? IMAGE_FORMAT_MESSAGE
                : view.engine === 'failed'
                  ? ENGINE_LOAD_FAILED_MESSAGE
                  : IMAGE_FAILED_MESSAGE,
          },
        });
      }
    },
    cancel() {
      run += 1;
      stopEngine();
      releaseReviewImage();
      set(CLOSED);
    },
    dispose() {
      if (disposed) return;
      run += 1;
      stopEngine();
      releaseReviewImage();
      disposed = true;
      view = CLOSED;
      listeners.clear();
    },
  };
}
