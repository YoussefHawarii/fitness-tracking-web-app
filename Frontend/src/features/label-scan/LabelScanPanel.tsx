import { useEffect, useRef, useState } from 'react';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import type { LabelFormUpdate } from '../add-product/extractionFormValues';
import {
  applicableReadings,
  defaultLabelSelection,
} from '../add-product/extractionFormValues';
import {
  readLabel,
  type LabelField,
  type LabelScanResult,
} from './labelReader';
import { LabelReview, type ReviewImage } from './LabelReview';
import {
  createTesseractEngine,
  type OcrEngine,
  type OcrProgress,
} from './ocrEngine';
import { LabelImageDecodeError, prepareLabelImage } from './prepareImage';

// Optional label scanning inside the Add Product form. Recognition runs on
// this device only; the panel hands the form the readings the user selected
// when they press Apply, and never submits anything itself.

type PanelState =
  | { kind: 'closed' }
  | { kind: 'choosing' }
  | { kind: 'recognizing' }
  | {
      kind: 'review';
      result: LabelScanResult;
      selected: ReadonlySet<LabelField>;
      // Set once Apply was pressed: what the form did with it.
      appliedNote?: string;
    }
  | { kind: 'error'; message: string };

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
}

async function reviewImageOf(image: Blob): Promise<ReviewImage> {
  const bitmap = await createImageBitmap(image);
  const { width, height } = bitmap;
  bitmap.close();
  return { url: URL.createObjectURL(image), width, height };
}

export function LabelScanPanel({ preview, onApply }: Props) {
  const [state, setState] = useState<PanelState>({ kind: 'closed' });
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [image, setImage] = useState<ReviewImage | undefined>();
  const engine = useRef<Promise<OcrEngine> | null>(null);
  const imageUrl = useRef<string | null>(null);
  const run = useRef(0);

  // The photo shown in the review lives only in memory; its object URL is
  // released whenever it is replaced, the scanner closes, or the form goes.
  function showImage(next: ReviewImage | undefined) {
    if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    imageUrl.current = next?.url ?? null;
    setImage(next);
  }

  function stopEngine() {
    run.current += 1;
    const current = engine.current;
    engine.current = null;
    void current?.then((e) => e.terminate()).catch(() => undefined);
  }

  useEffect(
    () => () => {
      stopEngine();
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current);
    },
    [],
  );

  // One engine per scanning session. A load that fails is forgotten so the
  // next scan can retry — but only if it is still the current engine, so a
  // late failure never orphans a newer worker that close() must terminate.
  function ensureEngine(): Promise<OcrEngine> {
    if (engine.current) return engine.current;
    const created = createTesseractEngine(setProgress);
    engine.current = created;
    created.catch(() => {
      if (engine.current === created) engine.current = null;
    });
    return created;
  }

  function open() {
    setState({ kind: 'choosing' });
    // Start loading the engine as soon as scanning is opened, so it is
    // ready sooner while the user takes the photo.
    void ensureEngine().catch(() => undefined);
  }

  function close() {
    stopEngine();
    showImage(undefined);
    setProgress(null);
    setState({ kind: 'closed' });
  }

  async function scan(file: File) {
    const thisRun = ++run.current;
    showImage(undefined);
    setState({ kind: 'recognizing' });
    try {
      const [prepared, ocr] = await Promise.all([
        prepareLabelImage(file),
        ensureEngine(),
      ]);
      const layout = await ocr.recognize(prepared);
      const reviewImage = await reviewImageOf(prepared);
      if (thisRun !== run.current) {
        URL.revokeObjectURL(reviewImage.url);
        return;
      }
      const result = readLabel(layout);
      showImage(reviewImage);
      setState({
        kind: 'review',
        result,
        selected: defaultLabelSelection(result),
      });
    } catch (err) {
      if (thisRun !== run.current) return;
      setState({
        kind: 'error',
        message:
          err instanceof LabelImageDecodeError
            ? 'This photo format can’t be read here — try “Take photo” or a JPEG/PNG.'
            : 'Could not read this image.',
      });
    }
  }

  function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so choosing the same photo again still fires a change.
    e.target.value = '';
    if (file) void scan(file);
  }

  if (state.kind === 'closed') {
    return (
      <SecondaryButton type="button" onClick={open} className="self-start">
        Scan nutrition label
      </SecondaryButton>
    );
  }

  const busy = state.kind === 'recognizing';
  const progressText =
    progress && progress.progress < 1
      ? progress.stage === 'loading'
        ? `Preparing scanner… first time only (${Math.round(progress.progress * 100)}%)`
        : `Reading label… ${Math.round(progress.progress * 100)}%`
      : busy
        ? 'Reading label…'
        : null;

  const review =
    state.kind === 'review'
      ? {
          plan: preview(state.result, state.selected),
          applicable: new Set(
            applicableReadings(state.result).map((r) => r.field),
          ),
        }
      : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <label className="spot-btn inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-label normal-case text-text">
          {state.kind === 'review' ? 'Retake photo' : 'Take photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            disabled={busy}
            onChange={onFileChosen}
          />
        </label>
        <label className="spot-btn inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-surface-raised px-5 py-2.5 text-label normal-case text-text">
          {state.kind === 'review' ? 'Choose another photo' : 'Choose photo'}
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={onFileChosen}
          />
        </label>
      </div>

      {progressText && (
        <p className="text-body text-text-muted" role="status">
          {progressText}
        </p>
      )}

      {state.kind === 'error' && (
        <p className="text-body text-warn">{state.message}</p>
      )}

      {state.kind === 'review' && review && (
        <>
          <LabelReview
            result={state.result}
            image={image}
            applicable={review.applicable}
            selected={state.selected}
            onToggle={(field) => {
              const selected = new Set(state.selected);
              if (selected.has(field)) selected.delete(field);
              else selected.add(field);
              setState({ ...state, selected, appliedNote: undefined });
            }}
            conflicts={review.plan.conflicts}
            missingRequired={review.plan.missingRequired}
          />
          {state.appliedNote ? (
            <p className="text-body text-text-muted">{state.appliedNote}</p>
          ) : (
            <PrimaryButton
              type="button"
              className="self-start"
              disabled={state.selected.size === 0}
              onClick={() => {
                setState({
                  ...state,
                  appliedNote: onApply(state.result, state.selected),
                });
              }}
            >
              Apply selected
            </PrimaryButton>
          )}
        </>
      )}

      <SecondaryButton type="button" onClick={close} className="self-start">
        {busy ? 'Cancel' : 'Close scanner'}
      </SecondaryButton>
    </div>
  );
}
