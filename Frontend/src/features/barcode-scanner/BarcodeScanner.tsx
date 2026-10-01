import { useEffect, useRef, useState } from 'react';
import { detectCameraFeatures } from './camera-capabilities';
import { createCropper } from './cropper';
import { createElementGate } from './element-gate';
import { createFrameDecoder } from './frame-decoder';
import { createFrameLoop } from './frame-loop';
import {
  createNativeDetector,
  type NativeBarcodeDetectorConstructor,
} from './native-detector';
import { createRetailDecoder } from './retail-decoder';
import { SCAN_BOX, computeScanRegion } from './scan-region';
import {
  createScanSession,
  type CameraHandle,
  type ScanState,
} from './scan-session';
import { ScannerView } from './ScannerView';

interface Props {
  onDecoded: (barcode: string) => void;
  onScanError?: (error: unknown) => void;
}

export function BarcodeScanner({ onDecoded, onScanError }: Props) {
  // Fed by the <video>'s callback ref; the camera is only requested once the
  // element exists, including when "Try again" swaps the error view back out.
  const [videoGate] = useState(() => createElementGate<HTMLVideoElement>());
  const sessionRef = useRef<ReturnType<typeof createScanSession> | null>(null);
  const restartRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<ScanState>({
    status: 'idle',
    barcode: null,
    torch: { available: false, on: false },
    zoom: null,
  });

  useEffect(() => {
    let cancelled = false;
    const cropper = createCropper(() => document.createElement('canvas'));
    const zxing = createRetailDecoder();
    let decodeFrame = createFrameDecoder({ native: null, zxing });
    let frameLoop: ReturnType<typeof createFrameLoop> | null = null;
    const detectorCtor = (
      globalThis as typeof globalThis & {
        BarcodeDetector?: NativeBarcodeDetectorConstructor;
      }
    ).BarcodeDetector;
    void createNativeDetector(detectorCtor).then((native) => {
      if (!cancelled && native)
        decodeFrame = createFrameDecoder({ native, zxing });
    });

    const openCamera = async (
      constraints: MediaStreamConstraints,
    ): Promise<CameraHandle> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException(
          'Camera access requires a secure browser context.',
          'NotSupportedError',
        );
      }
      const video = await videoGate.whenReady();
      if (cancelled) throw new DOMException('Scanner closed.', 'AbortError');
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (cancelled || videoGate.current() !== video) {
        stream.getTracks().forEach((track) => track.stop());
        throw new DOMException('Scanner closed.', 'AbortError');
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
        // Pausing before stopping keeps the last frame on screen while the
        // decoded barcode is looked up; srcObject is left in place for that
        // reason and is replaced by the next stream on retry or remount.
        stop() {
          video.pause();
          stream.getTracks().forEach((item) => item.stop());
        },
      };
    };

    const session = createScanSession({
      openCamera,
      onBarcode: (text) => {
        if (!cancelled) onDecoded(text);
      },
    });
    sessionRef.current = session;
    const unsubscribe = session.subscribe(() => {
      if (cancelled) return;
      const next = session.getState();
      setState(next);
      if (next.status !== 'scanning') {
        frameLoop?.stop();
        frameLoop = null;
        return;
      }
      if (frameLoop) return;
      const video = videoGate.current();
      if (!video) return;
      frameLoop = createFrameLoop({
        video,
        requestAnimationFrame: (callback) =>
          window.requestAnimationFrame(callback),
        cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
        onFrame: async () => {
          if (
            cancelled ||
            session.getState().status !== 'scanning' ||
            video.readyState < 2 ||
            !video.videoWidth ||
            !video.videoHeight ||
            !video.clientWidth ||
            !video.clientHeight
          )
            return;
          const region = computeScanRegion({
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            viewWidth: video.clientWidth,
            viewHeight: video.clientHeight,
            box: SCAN_BOX,
          });
          if (!region.width || !region.height) return;
          cropper.draw(video, region);
          const result = await decodeFrame({
            source: cropper.canvas,
            pixels: cropper.pixels,
          });
          if (!cancelled && session.getState().status === 'scanning')
            session.reportDecode(result);
        },
        onError: (error) => {
          if (cancelled) return;
          frameLoop = null;
          const errorDetails = error as { name?: unknown; message?: unknown };
          console.error('Barcode scanner frame processing failed', {
            name:
              typeof errorDetails.name === 'string'
                ? errorDetails.name
                : 'UnknownError',
            message:
              typeof errorDetails.message === 'string'
                ? errorDetails.message
                : String(error),
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            readyState: video.readyState,
            currentTime: video.currentTime,
            paused: video.paused,
          });
          onScanError?.(error);
        },
      });
      frameLoop.start();
    });

    const start = async () => {
      await session.start();
    };
    restartRef.current = () => void start();
    void start();

    return () => {
      cancelled = true;
      frameLoop?.stop();
      unsubscribe();
      session.stop();
      sessionRef.current = null;
      restartRef.current = null;
    };
    // Each mount owns one stream and decoder; FoodLog remounts to rescan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScannerView
      status={state.status === 'idle' ? 'starting' : state.status}
      torch={state.torch}
      onToggleTorch={() => void sessionRef.current?.toggleTorch()}
      videoRef={videoGate.set}
      onRetry={() => restartRef.current?.()}
    />
  );
}
