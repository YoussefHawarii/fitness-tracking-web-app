import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { ChecksumException, FormatException, NotFoundException } from '@zxing/library';

interface Props {
  onDecoded: (barcode: string) => void;
  // Fired when zxing's scan loop dies from a non-retryable decode error
  // (BarcodeScanner.tsx used to ignore the callback's error argument
  // entirely, so this failure mode was silent — see
  // docs/food-log-input-modes-diagnosis.md §1.3).
  onScanError?: (error: unknown) => void;
}

// Camera + @zxing/browser decode loop, per docs/technical-decisions.md
// (chosen over html5-qrcode for direct control over the camera stream).
export function BarcodeScanner({ onDecoded, onScanError }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    // Tracked outside React state so cleanup can always stop whatever
    // exists, even under StrictMode's mount->unmount->remount replay in dev
    // (decodeFromVideoDevice resolves `controls` asynchronously, so a plain
    // `controls?.stop()` in cleanup could otherwise miss a controls object
    // that hadn't been assigned yet when the first effect instance
    // unmounted, leaking that camera stream/scan loop — §1.5).
    let cancelled = false;
    let controls: { stop: () => void } | undefined;
    let decoded = false;
    let failed = false;

    reader
      .decodeFromVideoDevice(
        undefined,
        videoRef.current ?? undefined,
        // zxing passes a valid `controls` on every call (unlike the outer
        // `controls` variable below, which is only assigned once the
        // returned promise resolves) — use it directly so stopping on a
        // successful decode can't race that assignment.
        (result, decodeError, frameControls) => {
          // `cancelled` too, not just `decoded` — an effect instance whose
          // cleanup already ran (StrictMode's mount->unmount->remount) can
          // still have a callback in flight from before that; without this
          // check it would fire `onDecoded` on the current, live component
          // instance from an abandoned camera stream.
          if (decoded || cancelled || failed) return;
          if (result) {
            decoded = true;
            frameControls.stop();
            onDecoded(result.getText());
            return;
          }
          // Per zxing's own loop, a retryable miss (no barcode in view this
          // frame) re-arms itself and keeps calling back — normal. A
          // non-retryable error ends the scan loop for good; without this,
          // that failure was silent (§1.3).
          if (decodeError && !isRetryableDecodeError(decodeError)) {
            failed = true;
            frameControls.stop();
            const video = videoRef.current;
            const errorDetails = decodeError as { name?: unknown; message?: unknown };
            console.error('Barcode scanner frame processing failed', {
              name: typeof errorDetails.name === 'string' ? errorDetails.name : 'UnknownError',
              message: typeof errorDetails.message === 'string' ? errorDetails.message : String(decodeError),
              videoWidth: video?.videoWidth,
              videoHeight: video?.videoHeight,
              readyState: video?.readyState,
              currentTime: video?.currentTime,
              paused: video?.paused,
            });
            onScanError?.(decodeError);
          }
        },
      )
      .then((c) => {
        if (cancelled || decoded || failed) {
          c.stop();
          return;
        }
        controls = c;
      })
      .catch(() => setError('Could not access the camera. Check permissions and try again.'));

    return () => {
      cancelled = true;
      controls?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return <p className="p-4 text-body text-warn">{error}</p>;
  }

  return <video ref={videoRef} className="aspect-square w-full object-cover" muted />;
}

function isRetryableDecodeError(error: unknown): boolean {
  // Exception names are minified in production; prototype identity remains stable.
  return (
    error instanceof NotFoundException ||
    error instanceof ChecksumException ||
    error instanceof FormatException
  );
}
