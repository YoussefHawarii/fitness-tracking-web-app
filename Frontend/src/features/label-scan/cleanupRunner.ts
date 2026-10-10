import {
  cleanForRecognition,
  type CleanedLabel,
  type GrayImage,
  type Rect,
} from './labelCleanup';
import type { CleanupRequest, CleanupResponse } from './labelCleanup.worker';

// Makes the cleaned copy of a photo (labelCleanup.ts). The engine takes the
// maker as a parameter, so tests run the cleanup without a Worker.
//
// A cleaner may take over the photo's pixel buffer (the worker one transfers
// it), so the photo must not be used after the call. Aborting the signal
// stops the cleanup and rejects with an AbortError.
export type LabelCleaner = (
  photo: GrayImage,
  region?: Rect,
  signal?: AbortSignal,
) => Promise<CleanedLabel>;

// The worker itself died (failed to load, crashed, sent an unreadable
// message, or took too long) after taking the photo. The cleanup has not run,
// so a caller may run it again on the main thread from a fresh decode. A
// cleanup that ran and threw is a different error and is not retried.
export class CleanupWorkerDied extends Error {
  constructor() {
    super('The cleanup worker died.');
    this.name = 'CleanupWorkerDied';
  }
}

// How long a cleanup may take in a worker before it is given up on. A phone
// takes seconds on a large photo; this is for a worker that never answers.
export const CLEANUP_TIMEOUT_MS = 60_000;

// Set once a worker has died: later cleanups skip workers altogether and run
// on the main thread, rather than losing the photo to the same failure again.
let workerFailed = false;

// For tests: forget that a worker died.
export function forgetCleanupWorkerFailure(): void {
  workerFailed = false;
}

const abortError = () => new DOMException('Cleanup aborted.', 'AbortError');

// In a Web Worker, so the page doesn't freeze; the pixels are transferred
// both ways and the worker is thrown away after the one job, which releases
// everything it held. Where no worker can be started the cleanup runs here,
// on the main thread, with the photo intact. A worker that starts and then
// dies rejects with CleanupWorkerDied instead, as the photo is then gone: the
// caller decodes it again.
export function createOffThreadCleaner(timeoutMs: number): LabelCleaner {
  const onMainThread = (photo: GrayImage, region?: Rect) =>
    Promise.resolve().then(() => cleanForRecognition(photo, region));

  return (photo, region, signal) => {
    if (signal?.aborted) return Promise.reject(abortError());
    if (workerFailed || typeof Worker === 'undefined') {
      return onMainThread(photo, region);
    }
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('./labelCleanup.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch {
      return onMainThread(photo, region);
    }
    return new Promise<CleanedLabel>((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        worker.terminate();
      };
      const died = () => {
        finish();
        reject(new CleanupWorkerDied());
      };
      // Only a worker that errors could not load or run; one that is merely
      // slow (a phone) is not held against later cleanups.
      const broken = () => {
        workerFailed = true;
        died();
      };
      const aborted = () => {
        finish();
        reject(abortError());
      };
      worker.onmessage = (event: MessageEvent<CleanupResponse>) => {
        finish();
        if ('cleaned' in event.data) resolve(event.data.cleaned);
        else reject(new Error('The cleanup failed.'));
      };
      worker.onerror = broken;
      worker.onmessageerror = broken;
      const timer = setTimeout(died, timeoutMs);
      signal?.addEventListener('abort', aborted, { once: true });
      const request: CleanupRequest = { photo, region };
      worker.postMessage(request, [photo.data.buffer as ArrayBuffer]);
    });
  };
}

export const cleanOffThread: LabelCleaner =
  createOffThreadCleaner(CLEANUP_TIMEOUT_MS);
