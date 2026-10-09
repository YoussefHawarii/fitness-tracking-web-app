import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
} from 'react';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import type { LabelFormUpdate } from '../add-product/extractionFormValues';
import {
  applicableReadings,
  canApplyLabelSelection,
  defaultLabelSelection,
  toggleLabelSelection,
} from '../add-product/extractionFormValues';
import type { LabelField, LabelScanResult } from './labelReader';
import {
  createLabelScanSession,
  ENGINE_LOAD_FAILED_MESSAGE,
  LABEL_SCAN_PRIVACY_NOTE,
  type LabelScanSession,
} from './labelScanSession';
import { CropStep } from './CropStep';
import { LabelCamera, type LabelCameraProps } from './LabelCamera';
import { LabelReview } from './LabelReview';
import { createTesseractEngine } from './ocrEngine';
import { prepareLabelImage } from './prepareImage';

// Optional label scanning inside the Add Product form. Recognition runs on
// this device only; the panel hands the form the readings the user selected
// when they press Apply, and never submits anything itself.

async function showImage(image: Blob) {
  const bitmap = await createImageBitmap(image);
  const { width, height } = bitmap;
  bitmap.close();
  return { url: URL.createObjectURL(image), width, height };
}

function createBrowserSession(): LabelScanSession {
  return createLabelScanSession({
    createEngine: createTesseractEngine,
    prepareImage: prepareLabelImage,
    showImage,
    releaseImage: (url) => URL.revokeObjectURL(url),
  });
}

interface Props {
  // What applying the selected readings would do to the form right now —
  // conflicts and still-missing fields — without changing it.
  preview: (
    result: LabelScanResult,
    selected: ReadonlySet<LabelField>,
  ) => LabelFormUpdate;
  // Applies the selected readings and returns a note describing the result.
  onApply: (
    result: LabelScanResult,
    selected: ReadonlySet<LabelField>,
  ) => string;
  // The scanning session; the browser's Tesseract session by default.
  createSession?: () => LabelScanSession;
  // The framed label camera; the browser camera by default.
  Camera?: ComponentType<LabelCameraProps>;
}

// The user's choices for one review: which readings are selected, and the
// note once Apply was pressed. Tied to the scan run, so a retake starts
// fresh.
interface ReviewChoice {
  run: number;
  selected: ReadonlySet<LabelField>;
  appliedNote?: string;
}

export function LabelScanPanel({
  preview,
  onApply,
  createSession = createBrowserSession,
  Camera = LabelCamera,
}: Props) {
  const [session] = useState(createSession);
  const view = useSyncExternalStore(
    session.subscribe,
    session.view,
    session.view,
  );
  const [choice, setChoice] = useState<ReviewChoice | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  // The open camera is showing a problem; the photo buttons are then the
  // way forward.
  const [cameraProblem, setCameraProblem] = useState(false);

  // The worker and the photo are released when the form goes away
  // (including after the product is created).
  useEffect(() => () => session.dispose(), [session]);

  function openCamera() {
    setCameraProblem(false);
    setCameraOpen(true);
  }

  function closeCamera() {
    setCameraOpen(false);
    setCameraProblem(false);
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so choosing the same photo again still fires a change.
    e.target.value = '';
    if (!file) return;
    closeCamera();
    void session.scan(file);
  }

  if (!view.open) {
    return (
      <SecondaryButton
        type="button"
        onClick={() => session.open()}
        className="self-start"
      >
        Scan nutrition label
      </SecondaryButton>
    );
  }

  const { scan, progress } = view;
  const busy = scan.kind === 'preparing' || scan.kind === 'recognizing';
  // A photo was already taken, so the buttons offer another one.
  const rescanning = scan.kind === 'review' || scan.kind === 'cropping';
  const percent = progress ? Math.round(progress.progress * 100) : null;
  const progressText =
    view.engine === 'loading'
      ? `Preparing scanner… first time only${percent !== null ? ` (${percent}%)` : ''}`
      : busy
        ? `Reading label…${progress?.stage === 'recognizing' && percent !== null ? ` ${percent}%` : ''}`
        : null;

  const review =
    scan.kind === 'review'
      ? (() => {
          const current: ReviewChoice =
            choice?.run === scan.run
              ? choice
              : { run: scan.run, selected: defaultLabelSelection(scan.result) };
          return {
            current,
            plan: preview(scan.result, current.selected),
            applicable: new Set(
              applicableReadings(scan.result).map((r) => r.field),
            ),
          };
        })()
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-label normal-case tracking-normal text-text-muted">
        {LABEL_SCAN_PRIVACY_NOTE}
      </p>
      {cameraOpen && (
        <Camera
          onCapture={(photo) => {
            closeCamera();
            void session.scanFramed(photo);
          }}
          onClose={closeCamera}
          onProblemChange={setCameraProblem}
        />
      )}
      {(!cameraOpen || cameraProblem) && (
        <div className="flex flex-wrap gap-2">
          {!cameraOpen && (
            <PrimaryButton type="button" onClick={openCamera}>
              {rescanning ? 'Scan again with camera' : 'Scan with camera'}
            </PrimaryButton>
          )}
          <label className="spot-btn inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-label normal-case text-text">
            {rescanning ? 'Retake photo' : 'Take photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={onFileChosen}
            />
          </label>
          <label className="spot-btn inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-label normal-case text-text">
            {rescanning ? 'Choose another photo' : 'Choose photo'}
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={onFileChosen}
            />
          </label>
        </div>
      )}

      {progressText && (
        <p className="text-body text-text-muted" role="status">
          {progressText}
        </p>
      )}

      {view.engine === 'failed' && (
        <div className="flex flex-col gap-2">
          <p className="text-body text-warn">{ENGINE_LOAD_FAILED_MESSAGE}</p>
          <SecondaryButton
            type="button"
            onClick={() => session.retry()}
            className="self-start"
          >
            Try again
          </SecondaryButton>
        </div>
      )}

      {scan.kind === 'error' && scan.message !== ENGINE_LOAD_FAILED_MESSAGE && (
        <p className="text-body text-warn">{scan.message}</p>
      )}

      {!cameraOpen && scan.kind === 'cropping' && (
        <CropStep
          key={scan.image.url}
          image={scan.image}
          onReadRegion={(region) => void session.readRegion(region)}
          onReadWhole={() => void session.readWholePhoto()}
        />
      )}

      {!cameraOpen && scan.kind === 'review' && review && (
        <>
          <LabelReview
            result={scan.result}
            image={scan.image}
            applicable={review.applicable}
            selected={review.current.selected}
            onToggle={(field) =>
              setChoice({
                run: scan.run,
                selected: toggleLabelSelection(review.current.selected, field),
              })
            }
            conflicts={review.plan.conflicts}
            missingRequired={review.plan.missingRequired}
          />
          {review.current.appliedNote ? (
            <p className="text-body text-text-muted">
              {review.current.appliedNote}
            </p>
          ) : (
            <PrimaryButton
              type="button"
              className="self-start"
              disabled={!canApplyLabelSelection(review.current.selected)}
              onClick={() =>
                setChoice({
                  ...review.current,
                  appliedNote: onApply(scan.result, review.current.selected),
                })
              }
            >
              Apply selected
            </PrimaryButton>
          )}
        </>
      )}

      <SecondaryButton
        type="button"
        onClick={() => {
          session.cancel();
          setChoice(null);
          closeCamera();
        }}
        className="self-start"
      >
        {busy ? 'Cancel' : 'Close scanner'}
      </SecondaryButton>
    </div>
  );
}
