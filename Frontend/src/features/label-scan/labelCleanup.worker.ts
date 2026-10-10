import {
  cleanForRecognition,
  transferablesOf,
  type CleanedLabel,
  type GrayImage,
  type Rect,
} from './labelCleanup';

// Runs the cleanup (labelCleanup.ts) off the main thread: it takes the better
// part of a second on a desktop, several on a phone, and would freeze the
// page. The photo's pixels arrive transferred, not copied, and the cleaned
// copy goes back the same way. The worker has no network access to use and
// sends nothing anywhere else (ADR 0008).

export interface CleanupRequest {
  photo: GrayImage;
  region?: Rect;
}

export type CleanupResponse = { cleaned: CleanedLabel } | { failed: true };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CleanupRequest>) => void) | null;
  postMessage(message: CleanupResponse, transfer: Transferable[]): void;
};

scope.onmessage = (event) => {
  try {
    const cleaned = cleanForRecognition(event.data.photo, event.data.region);
    scope.postMessage({ cleaned }, transferablesOf(cleaned));
  } catch {
    scope.postMessage({ failed: true }, []);
  }
};
