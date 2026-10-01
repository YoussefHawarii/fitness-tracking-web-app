import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import {
  BarcodeFormat,
  ChecksumException,
  DecodeHintType,
  FormatException,
  NotFoundException,
} from '@zxing/library';
import { detectCameraFeatures } from './camera-capabilities';
import { createElementGate } from './element-gate';
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

const hints = new Map([
  [
    DecodeHintType.POSSIBLE_FORMATS,
    [
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.UPC_A,
      BarcodeFormat.UPC_E,
      BarcodeFormat.CODE_128,
    ],
  ],
]);

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let failed = false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const reader = new BrowserMultiFormatReader(hints);

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
      if (!cancelled) setState(session.getState());
    });

    const schedule = () => {
      if (!cancelled && !failed && session.getState().status === 'scanning') {
        timer = setTimeout(tick, 120);
      }
    };
    const tick = () => {
      if (cancelled || failed || session.getState().status !== 'scanning')
        return;
      const video = videoGate.current();
      if (
        !video ||
        video.readyState < 2 ||
        !video.videoWidth ||
        !video.videoHeight ||
        !video.clientWidth ||
        !video.clientHeight
      ) {
        schedule();
        return;
      }
      try {
        if (!context) throw new Error('Canvas 2D context is unavailable');
        const region = computeScanRegion({
          videoWidth: video.videoWidth,
          videoHeight: video.videoHeight,
          viewWidth: video.clientWidth,
          viewHeight: video.clientHeight,
          box: SCAN_BOX,
        });
        if (region.width && region.height) {
          canvas.width = region.width;
          canvas.height = region.height;
          context.drawImage(
            video,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            region.width,
            region.height,
          );
          session.reportDecode(reader.decodeFromCanvas(canvas).getText());
        }
      } catch (error) {
        if (isRetryableDecodeError(error)) {
          session.reportDecode(null);
        } else {
          failed = true;
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
        }
      }
      schedule();
    };

    const start = async () => {
      await session.start();
      if (!cancelled) schedule();
    };
    restartRef.current = () => void start();
    void start();

    return () => {
      cancelled = true;
      clearTimeout(timer);
      unsubscribe();
      session.stop();
      sessionRef.current = null;
      restartRef.current = null;
    };
    // Each mount owns one stream and reader; FoodLog remounts to rescan.
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

function isRetryableDecodeError(error: unknown): boolean {
  // Exception names are minified in production; prototype identity remains stable.
  return (
    error instanceof NotFoundException ||
    error instanceof ChecksumException ||
    error instanceof FormatException
  );
}
