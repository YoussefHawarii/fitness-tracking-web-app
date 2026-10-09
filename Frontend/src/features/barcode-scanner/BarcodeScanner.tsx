import { useEffect, useRef, useState } from 'react';
import { createCropper } from './cropper';
import { createElementGate } from './element-gate';
import { createFrameDecoder } from './frame-decoder';
import { createFrameLoop } from './frame-loop';
import {
  createNativeDetector,
  type NativeBarcodeDetectorConstructor,
} from './native-detector';
import { createCameraOpener } from './open-camera';
import { createRetailDecoder } from './retail-decoder';
import { DECODE_REGION, computeScanRegion } from './scan-region';
import {
  INITIAL_SCAN_STATE,
  createScanSession,
  type ScanState,
} from './scan-session';
import { ScannerView } from './ScannerView';

interface Props {
  onDecoded: (barcode: string) => void;
  onScanError?: (error: unknown) => void;
}

export function BarcodeScanner({ onDecoded, onScanError }: Props) {
  const onDecodedRef = useRef(onDecoded);
  const onScanErrorRef = useRef(onScanError);
  useEffect(() => {
    onDecodedRef.current = onDecoded;
    onScanErrorRef.current = onScanError;
  }, [onDecoded, onScanError]);

  // Fed by the <video>'s callback ref; the camera is only requested once the
  // element exists, including when "Try again" swaps the error view back out.
  const [videoGate] = useState(() => createElementGate<HTMLVideoElement>());
  const sessionRef = useRef<ReturnType<typeof createScanSession> | null>(null);
  const restartRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<ScanState>(INITIAL_SCAN_STATE);

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

    const openCamera = createCameraOpener({
      videoGate,
      isCancelled: () => cancelled,
    });

    const session = createScanSession({
      openCamera,
      onBarcode: (text) => {
        if (!cancelled) onDecodedRef.current(text);
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
            box: DECODE_REGION,
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
          onScanErrorRef.current?.(error);
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
