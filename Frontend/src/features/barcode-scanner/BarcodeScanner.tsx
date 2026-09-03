import { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';

interface Props {
  onDecoded: (barcode: string) => void;
}

// Camera + @zxing/browser decode loop, per docs/technical-decisions.md
// (chosen over html5-qrcode for direct control over the camera stream).
export function BarcodeScanner({ onDecoded }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let controls: { stop: () => void } | undefined;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current ?? undefined, (result) => {
        if (result) {
          onDecoded(result.getText());
        }
      })
      .then((c) => {
        controls = c;
      })
      .catch(() => setError('Could not access the camera. Check permissions and try again.'));

    return () => controls?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return <p className="p-4 text-body text-warn">{error}</p>;
  }

  return <video ref={videoRef} className="aspect-square w-full object-cover" muted />;
}
