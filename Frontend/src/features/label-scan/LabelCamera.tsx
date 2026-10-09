import { useEffect, useRef, useState, type Ref } from 'react';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import { buildCameraConstraints } from '../barcode-scanner/camera-capabilities';
import { createElementGate } from '../barcode-scanner/element-gate';
import { createCameraOpener } from '../barcode-scanner/open-camera';
import {
  INITIAL_SCAN_STATE,
  createScanSession,
  type ScanState,
  type TorchState,
} from '../barcode-scanner/scan-session';
import { cameraProblemMessage } from '../barcode-scanner/camera-messages';
import {
  LABEL_CAMERA_RESOLUTION,
  LABEL_FRAMES,
  captureFramedStill,
  type LabelFrameShape,
} from './labelFrame';

// The label camera: a live viewfinder with a frame to line the nutrition
// table up in, tall or wide. It opens the camera like the barcode scanner
// does (rear camera, continuous focus, 2x zoom where the camera supports
// it, so the phone is held far enough back to stay in focus, and the
// flashlight), and hands over only what is inside the frame, at the
// camera's full resolution. The camera is released as soon as the photo is
// taken or the camera is closed.

export interface LabelCameraProps {
  onCapture: (photo: Blob) => void;
  onClose: () => void;
  // Reports whether the camera is showing a problem (permission denied, no
  // camera, busy, interrupted…), so the panel can offer the photo buttons
  // as the way forward.
  onProblemChange?: (problem: boolean) => void;
}

const INTERRUPTED_MESSAGE =
  'The camera stopped, for example because the screen locked or another app took it. Try again to reopen it.';

export function LabelCamera({
  onCapture,
  onClose,
  onProblemChange,
}: LabelCameraProps) {
  const [videoGate] = useState(() => createElementGate<HTMLVideoElement>());
  const sessionRef = useRef<ReturnType<typeof createScanSession> | null>(null);
  // False once the camera is closed, so a photo still being encoded then is
  // dropped instead of starting a read the user already walked away from.
  const openRef = useRef(false);
  const [state, setState] = useState<ScanState>(INITIAL_SCAN_STATE);
  const [shape, setShape] = useState<LabelFrameShape>('tall');
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    openRef.current = true;
    const session = createScanSession({
      openCamera: createCameraOpener({
        videoGate,
        isCancelled: () => cancelled,
      }),
      // Labels aren't decoded live; the user takes the photo.
      onBarcode: () => {},
      constraints: buildCameraConstraints(LABEL_CAMERA_RESOLUTION),
    });
    sessionRef.current = session;
    const unsubscribe = session.subscribe(() => {
      if (!cancelled) setState(session.getState());
    });
    void session.start();
    return () => {
      cancelled = true;
      openRef.current = false;
      unsubscribe();
      session.stop();
      sessionRef.current = null;
    };
  }, [videoGate]);

  async function capture() {
    const video = videoGate.current();
    if (!video || capturing) return;
    setCapturing(true);
    try {
      const photo = await captureFramedStill(video, shape);
      if (!openRef.current) return;
      if (photo) {
        sessionRef.current?.stop();
        onCapture(photo);
        return;
      }
    } catch {
      // A frame that can't be drawn yet: the user can tap again.
    }
    setCapturing(false);
  }

  const problem = cameraProblemMessage(state.status, INTERRUPTED_MESSAGE);
  const hasProblem = problem !== null;
  useEffect(() => {
    onProblemChange?.(hasProblem);
  }, [hasProblem, onProblemChange]);

  if (problem) {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-body text-warn">
          {problem}
        </p>
        <div className="flex flex-wrap gap-2">
          <SecondaryButton
            type="button"
            onClick={() => void sessionRef.current?.start()}
          >
            Try again
          </SecondaryButton>
          <SecondaryButton type="button" onClick={onClose}>
            Close camera
          </SecondaryButton>
        </div>
      </div>
    );
  }

  const scanning = state.status === 'scanning';
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-text-muted">
        Fit the nutrition table inside the frame, keep it flat and in focus,
        then take the photo.
      </p>
      <Viewfinder
        videoRef={videoGate.set}
        shape={shape}
        starting={!scanning}
        torch={state.torch}
        onToggleTorch={() => void sessionRef.current?.toggleTorch()}
      />
      <div className="flex flex-wrap gap-2">
        <PrimaryButton
          type="button"
          disabled={!scanning || capturing}
          onClick={() => void capture()}
        >
          Take label photo
        </PrimaryButton>
        <SecondaryButton
          type="button"
          aria-pressed={shape === 'wide'}
          className={shape === 'wide' ? 'border-accent text-accent' : ''}
          onClick={() => setShape(shape === 'tall' ? 'wide' : 'tall')}
        >
          Wide table frame
        </SecondaryButton>
        <SecondaryButton type="button" onClick={onClose}>
          Close camera
        </SecondaryButton>
      </div>
    </div>
  );
}

// The live video with the frame drawn over it; the photo outside the frame
// is dimmed.
function Viewfinder({
  videoRef,
  shape,
  starting,
  torch,
  onToggleTorch,
}: {
  videoRef: Ref<HTMLVideoElement>;
  shape: LabelFrameShape;
  starting: boolean;
  torch: TorchState;
  onToggleTorch: () => void;
}) {
  const frame = LABEL_FRAMES[shape];
  return (
    <div className="relative aspect-[3/4] w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        className="h-full w-full object-cover"
        muted
        playsInline
        autoPlay
      />
      <div
        role="img"
        aria-label={shape === 'tall' ? 'Tall label frame' : 'Wide label frame'}
        className="absolute rounded-md border-2 border-accent shadow-[0_0_0_100vmax_rgba(0,0,0,0.5)]"
        style={{
          left: `${frame.x * 100}%`,
          top: `${frame.y * 100}%`,
          width: `${frame.width * 100}%`,
          height: `${frame.height * 100}%`,
        }}
      />
      {starting && (
        <div
          role="status"
          aria-live="polite"
          className="absolute bottom-4 left-4 rounded-md bg-surface-raised/90 px-3 py-2 text-body text-text-muted"
        >
          Starting camera…
        </div>
      )}
      {torch.available && (
        <button
          type="button"
          aria-pressed={torch.on}
          onClick={onToggleTorch}
          className={`absolute bottom-4 right-4 rounded-full px-4 py-2 text-body ${torch.on ? 'bg-accent text-bg' : 'bg-black/70 text-white'}`}
        >
          Flashlight
        </button>
      )}
    </div>
  );
}
