import type { Ref } from 'react';
import { SCAN_BOX } from './scan-region';
import type { ScanStatus } from './scan-session';

type Props = {
  status: ScanStatus;
  torch: { available: boolean; on: boolean };
  onToggleTorch: () => void;
  videoRef?: Ref<HTMLVideoElement>;
  onRetry?: () => void;
};

export function ScannerView({
  status,
  torch,
  onToggleTorch,
  videoRef,
  onRetry,
}: Props) {
  if (status !== 'starting' && status !== 'scanning' && status !== 'decoded') {
    const message =
      status === 'permission-denied'
        ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
        : status === 'unavailable'
          ? 'No camera is available. Check that a camera is connected and accessible.'
          : status === 'error'
            ? 'The camera could not start. Please try again.'
            : status === 'interrupted'
              ? 'The camera stopped, for example because the screen locked or another app took it. Try again to resume scanning.'
              : null;
    return message ? (
      <div className="p-4 text-body text-warn">
        <p>{message}</p>
        {onRetry && <button onClick={onRetry}>Try again</button>}
      </div>
    ) : null;
  }
  return (
    <div className="relative aspect-square w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        muted
        playsInline
        autoPlay
      />
      <div
        aria-label="Barcode scan area"
        className="absolute rounded-xl border-2 border-white shadow-[0_0_0_100vmax_rgba(0,0,0,0.48)]"
        style={{
          left: `${SCAN_BOX.x * 100}%`,
          top: `${SCAN_BOX.y * 100}%`,
          width: `${SCAN_BOX.width * 100}%`,
          height: `${SCAN_BOX.height * 100}%`,
        }}
      >
        <span className="absolute left-3 right-3 top-1/2 h-px bg-white/80" />
      </div>
      {torch.available && status !== 'decoded' && (
        <button
          type="button"
          aria-label={torch.on ? 'Turn off flashlight' : 'Turn on flashlight'}
          onClick={onToggleTorch}
          className="absolute bottom-4 right-4 rounded-full bg-black/70 px-4 py-2 text-body text-white"
        >
          {torch.on ? 'Turn off flashlight' : 'Turn on flashlight'}
        </button>
      )}
    </div>
  );
}
