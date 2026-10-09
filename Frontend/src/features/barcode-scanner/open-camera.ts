import { detectCameraFeatures } from './camera-capabilities';
import type { createElementGate } from './element-gate';
import type { CameraHandle } from './scan-session';

// Opens the camera into the <video> the gate holds, once it is attached:
// continuous focus when the camera offers it, and the handle the scan
// session drives (zoom, torch, the OS taking the camera away, stopping).
// Shared by the barcode scanner and the label camera.
export function createCameraOpener({
  videoGate,
  isCancelled,
}: {
  videoGate: ReturnType<typeof createElementGate<HTMLVideoElement>>;
  isCancelled: () => boolean;
}) {
  return async (constraints: MediaStreamConstraints): Promise<CameraHandle> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException(
        'Camera access requires a secure browser context.',
        'NotSupportedError',
      );
    }
    const video = await videoGate.whenReady();
    if (isCancelled()) throw new DOMException('Camera closed.', 'AbortError');
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    if (isCancelled() || videoGate.current() !== video) {
      stream.getTracks().forEach((track) => track.stop());
      throw new DOMException('Camera closed.', 'AbortError');
    }
    video.srcObject = stream;
    void video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      video.srcObject = null;
      throw new DOMException('No video track.', 'NotFoundError');
    }
    const capabilities = (track.getCapabilities?.() ?? {}) as Record<
      string,
      unknown
    >;
    if (detectCameraFeatures(capabilities).continuousFocus) {
      void track
        .applyConstraints({
          advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
        })
        .catch(() => {});
    }
    return {
      capabilities,
      applyZoom: (zoom) =>
        track.applyConstraints({
          advanced: [{ zoom } as MediaTrackConstraintSet],
        }),
      setTorch: (torch) =>
        track.applyConstraints({
          advanced: [{ torch } as MediaTrackConstraintSet],
        }),
      onEnded(listener) {
        track.addEventListener('ended', listener);
        return () => track.removeEventListener('ended', listener);
      },
      // Pausing before stopping keeps the last frame on screen (the barcode
      // scanner shows it while the decoded barcode is looked up); srcObject
      // is left in place for that reason and is replaced by the next stream
      // on retry or remount.
      stop() {
        video.pause();
        stream.getTracks().forEach((item) => item.stop());
      },
    };
  };
}
