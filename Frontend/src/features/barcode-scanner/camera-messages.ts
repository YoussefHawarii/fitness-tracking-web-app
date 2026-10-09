import type { ScanStatus } from './scan-session';

// What to tell the user when the camera isn't running, or null while it
// is (or is starting). Shared with the label camera.
export function cameraProblemMessage(status: ScanStatus): string | null {
  return status === 'permission-denied'
    ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
    : status === 'unavailable'
      ? 'No camera is available. Check that a camera is connected and accessible.'
      : status === 'error'
        ? 'The camera could not start. Please try again.'
        : status === 'camera-busy'
          ? 'The camera is being used by another app. Close it and try again.'
          : status === 'unsupported'
            ? 'The camera needs a secure (https) page in a supported browser.'
            : status === 'interrupted'
              ? 'The camera stopped, for example because the screen locked or another app took it. Try again to resume scanning.'
              : null;
}
