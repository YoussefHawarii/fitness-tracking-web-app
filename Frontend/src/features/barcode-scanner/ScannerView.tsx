import type { Ref } from 'react';
import { SCAN_SLOT } from './scan-region';
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
        role="img"
        aria-label="Barcode scan area"
        className="absolute rounded-sm border border-accent/30 shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]"
        style={{
          left: `${SCAN_SLOT.x * 100}%`,
          top: `${SCAN_SLOT.y * 100}%`,
          width: `${SCAN_SLOT.width * 100}%`,
          height: `${SCAN_SLOT.height * 100}%`,
        }}
      >
        <span
          aria-hidden="true"
          data-slot-corner="top-left"
          className="absolute left-0 top-0 h-[32%] w-[14%] rounded-tl-sm border-l-2 border-t-2 border-accent drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]"
        />
        <span
          aria-hidden="true"
          data-slot-corner="top-right"
          className="absolute right-0 top-0 h-[32%] w-[14%] rounded-tr-sm border-r-2 border-t-2 border-accent drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]"
        />
        <span
          aria-hidden="true"
          data-slot-corner="bottom-left"
          className="absolute bottom-0 left-0 h-[32%] w-[14%] rounded-bl-sm border-b-2 border-l-2 border-accent drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]"
        />
        <span
          aria-hidden="true"
          data-slot-corner="bottom-right"
          className="absolute bottom-0 right-0 h-[32%] w-[14%] rounded-br-sm border-b-2 border-r-2 border-accent drop-shadow-[0_0_2px_rgba(0,0,0,0.85)]"
        />
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
