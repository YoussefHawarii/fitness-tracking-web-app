import { readLabel, type LabelScanResult } from './labelReader';
import type { OcrEngine, OcrProgress, RecognizeOptions } from './ocrEngine';
import type { OcrLayout } from './ocrLayout';
import { LabelImageDecodeError, type PhotoFraction } from './prepareImage';
import type { CropRectangle } from './recognitionPasses';

// The Label-scan session: everything between opening label scanning and
// closing it — loading the on-device engine (with progress and retry),
// preparing each photo and showing it for cropping, reading a region of it
// (cut from the original photo, at its full detail) or the whole photo (with
// one automatic fallback pass), reading a photo already framed by the label
// camera straight away, discarding results
// of a cancelled or replaced run, reusing one worker for every retake, and
// releasing the worker and the photo. It holds no React state and talks to the
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
  // Prepares the photo, or only the given part of it, for recognition.
  prepareImage: (file: Blob, crop?: PhotoFraction) => Promise<Blob>;
  // Makes the prepared photo viewable for cropping and review (an object
  // URL).
  showImage: (image: Blob) => Promise<ReviewImage>;
  releaseImage: (url: string) => void;
}

export type EngineStatus = 'idle' | 'loading' | 'ready' | 'failed';

export type ScanStatus =
  | { kind: 'none' }
  | { kind: 'preparing' }
  | { kind: 'cropping'; image: ReviewImage }
  | { kind: 'recognizing' }
  | { kind: 'review'; result: LabelScanResult; image: ReviewImage; run: number }
  | { kind: 'error'; message: string };

export interface LabelScanView {
  open: boolean;
  engine: EngineStatus;
  progress: OcrProgress | null;
  scan: ScanStatus;
}

// The privacy promise shown while label scanning is open (ADR 0008). It
// claims only what is true: the browser may keep the engine cached, the
// app doesn't work offline, and readings are checked, not guaranteed.
export const LABEL_SCAN_PRIVACY_NOTE =
  'Your label photo and the text read from it are processed on this device and are never uploaded or saved. Only the values you review and submit are sent to your account. The first scan downloads the text-recognition engine from this site; your browser may keep that engine cached.';

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
  // Prepares a photo and shows it for cropping; nothing is recognized yet.
  // A scan started while another runs replaces it: the earlier run's
  // result is discarded when it arrives.
  scan(photo: Blob): Promise<void>;
  // Reads one region of the photo being cropped, given in prepared-image
  // pixels, as a single block of text. Does nothing unless a photo is
  // being cropped.
  readRegion(region: CropRectangle): Promise<void>;
  // Reads the whole photo being cropped. If no per 100 column is found,
  // one more pass for scattered text is tried and used if it finds one.
  // Does nothing unless a photo is being cropped.
  readWholePhoto(): Promise<void>;
  // Reads a photo the label camera already cut to its frame: no crop step,
  // read as one block of text, with the same fallback pass as the whole
  // photo. Replaces any scan in progress, like scan().
  scanFramed(photo: Blob): Promise<void>;
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
  // The original photo, the prepared photo (or prepared crop) that is read,
  // and the object URL showing it, from the moment it is shown until it is
  // released. Kept separately from the status because the status holds no
  // photo while recognizing.
  let held: { photo: Blob; prepared: Blob; image: ReviewImage } | null = null;

  function set(next: Partial<LabelScanView>) {
    view = { ...view, ...next };
    for (const listener of listeners) listener();
  }

  // Releases the held photo, at most once.
  function releaseHeldImage() {
    if (!held) return;
    const { image } = held;
    held = null;
    deps.releaseImage(image.url);
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

  // Prepares a photo and holds it with its shown image; resolves false if
  // that failed (the error is shown) or the run was replaced meanwhile
  // (anything it showed is released).
  async function prepareAndHold(photo: Blob, thisRun: number) {
    try {
      const prepared = await deps.prepareImage(photo);
      if (thisRun !== run) return false;
      const image = await deps.showImage(prepared);
      if (thisRun !== run) {
        deps.releaseImage(image.url);
        return false;
      }
      held = { photo, prepared, image };
      return true;
    } catch (err) {
      if (thisRun === run)
        set({
          scan: {
            kind: 'error',
            message:
              err instanceof LabelImageDecodeError
                ? IMAGE_FORMAT_MESSAGE
                : IMAGE_FAILED_MESSAGE,
          },
        });
      return false;
    }
  }

  // Cuts a region (in the shown photo's pixels) from the original photo
  // and makes that crop the held photo, so it is what is read and what the
  // review shows. Resolves false if the run was replaced meanwhile.
  async function holdCrop(region: CropRectangle, thisRun: number) {
    if (!held) return false;
    const { photo, image } = held;
    const crop: PhotoFraction = {
      left: region.left / image.width,
      top: region.top / image.height,
      width: region.width / image.width,
      height: region.height / image.height,
    };
    const prepared = await deps.prepareImage(photo, crop);
    if (thisRun !== run) return false;
    const shown = await deps.showImage(prepared);
    if (thisRun !== run) {
      deps.releaseImage(shown.url);
      return false;
    }
    releaseHeldImage();
    held = { photo, prepared, image: shown };
    return true;
  }

  // Reads the held photo. Queued behind any recognition still running; a
  // run replaced or cancelled while it waited never starts, and never
  // starts the fallback pass either.
  async function readHeld(
    thisRun: number,
    options: RecognizeOptions | undefined,
    fallback: boolean,
  ) {
    const recognize = (ocr: OcrEngine, passOptions?: RecognizeOptions) => {
      const job = recognitions.then<OcrLayout | typeof STALE>(() => {
        if (thisRun !== run || !held) return STALE;
        return passOptions
          ? ocr.recognize(held.prepared, passOptions)
          : ocr.recognize(held.prepared);
      });
      recognitions = job.catch(() => undefined);
      return job;
    };
    try {
      const ocr = await ensureEngine();
      if (thisRun !== run) return;
      const layout = await recognize(ocr, options);
      if (layout === STALE || thisRun !== run) return;
      let result = readLabel(layout);
      if (fallback && result.outcome === 'no-per-100-column') {
        const sparse = await recognize(ocr, { layout: 'sparse' });
        if (sparse === STALE || thisRun !== run) return;
        const retried = readLabel(sparse);
        if (retried.outcome !== 'no-per-100-column') result = retried;
      }
      // Not reachable while the run is current; if it ever were, fail with
      // the usual error instead of leaving "Reading label…" up for good.
      if (!held) throw new Error('No photo held.');
      set({
        scan: { kind: 'review', result, image: held.image, run: thisRun },
      });
    } catch {
      if (thisRun !== run) return;
      releaseHeldImage();
      set({
        scan: {
          kind: 'error',
          message:
            view.engine === 'failed'
              ? ENGINE_LOAD_FAILED_MESSAGE
              : IMAGE_FAILED_MESSAGE,
        },
      });
    }
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
      releaseHeldImage();
      set({ open: true, scan: { kind: 'preparing' } });
      // Loads while the photo is prepared and cropped.
      void ensureEngine().catch(() => undefined);
      if (!(await prepareAndHold(photo, thisRun)) || !held) return;
      set({ scan: { kind: 'cropping', image: held.image } });
    },
    async readRegion(region) {
      if (disposed || view.scan.kind !== 'cropping' || !held) return;
      const thisRun = run;
      set({ scan: { kind: 'recognizing' } });
      try {
        if (!(await holdCrop(region, thisRun))) return;
      } catch {
        if (thisRun !== run) return;
        releaseHeldImage();
        set({ scan: { kind: 'error', message: IMAGE_FAILED_MESSAGE } });
        return;
      }
      // A region the user chose is read as is: no fallback pass.
      await readHeld(thisRun, { layout: 'block' }, false);
    },
    async readWholePhoto() {
      if (disposed || view.scan.kind !== 'cropping' || !held) return;
      const thisRun = run;
      set({ scan: { kind: 'recognizing' } });
      await readHeld(thisRun, undefined, true);
    },
    async scanFramed(photo) {
      if (disposed) return;
      const thisRun = ++run;
      releaseHeldImage();
      set({ open: true, scan: { kind: 'preparing' } });
      void ensureEngine().catch(() => undefined);
      if (!(await prepareAndHold(photo, thisRun))) return;
      set({ scan: { kind: 'recognizing' } });
      await readHeld(thisRun, { layout: 'block' }, true);
    },
    cancel() {
      run += 1;
      stopEngine();
      releaseHeldImage();
      set(CLOSED);
    },
    dispose() {
      if (disposed) return;
      run += 1;
      stopEngine();
      releaseHeldImage();
      disposed = true;
      view = CLOSED;
      listeners.clear();
    },
  };
}
