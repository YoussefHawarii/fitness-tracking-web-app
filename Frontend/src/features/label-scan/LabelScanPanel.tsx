import { useEffect, useRef, useState } from 'react';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';
import {
  readLabel,
  type LabelField,
  type LabelReading,
  type LabelScanResult,
} from './labelReader';
import {
  createTesseractEngine,
  type OcrEngine,
  type OcrProgress,
} from './ocrEngine';
import { LabelImageDecodeError, prepareLabelImage } from './prepareImage';

// Optional label scanning inside the Add Product form. Recognition runs on
// this device only; the panel hands the form a structured result when the
// user presses Apply, and never submits anything itself.

const LABEL_FIELD_NAMES: Record<LabelField, string> = {
  caloriesPer100g: 'Calories',
  proteinPer100g: 'Protein',
  carbsPer100g: 'Carbs',
  fatPer100g: 'Fat',
};

const STATUS_TEXT: Record<LabelReading['status'], string> = {
  read: '✓ read',
  'needs-check': '⚠ needs check',
  'not-found': '— not found',
};

type PanelState =
  | { kind: 'closed' }
  | { kind: 'choosing' }
  | { kind: 'recognizing' }
  // `appliedNote` is set once Apply was pressed: what the form did with it.
  | { kind: 'review'; result: LabelScanResult; appliedNote?: string }
  | { kind: 'error'; message: string };

interface Props {
  // Applies the result to the form and returns a note describing what
  // happened, shown in place of the Apply button.
  onApply: (result: LabelScanResult) => string;
}

export function LabelReviewList({ result }: { result: LabelScanResult }) {
  return (
    <div className="flex flex-col gap-2">
      {result.warnings.map((warning) => (
        <p key={warning} className="text-body text-warn">
          {warning}
        </p>
      ))}
      {result.outcome !== 'ok' && (
        <p className="text-body text-text-muted">
          For reference only — these values can’t be applied as per-100 values.
        </p>
      )}
      <ul className="flex flex-col gap-1">
        {result.readings.map((reading) => (
          <li
            key={reading.field}
            className="flex justify-between gap-3 text-body text-text"
          >
            <span>{LABEL_FIELD_NAMES[reading.field]}</span>
            <span>
              {reading.value !== undefined
                ? `${reading.value} ${reading.unit ?? ''}`.trim()
                : reading.conflictingValues
                  ? `${reading.conflictingValues.join(' or ')}?`
                  : '—'}
            </span>
            <span className="text-text-muted">
              {STATUS_TEXT[reading.status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LabelScanPanel({ onApply }: Props) {
  const [state, setState] = useState<PanelState>({ kind: 'closed' });
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const engine = useRef<Promise<OcrEngine> | null>(null);
  const run = useRef(0);

  function stopEngine() {
    run.current += 1;
    const current = engine.current;
    engine.current = null;
    void current?.then((e) => e.terminate()).catch(() => undefined);
  }

  useEffect(() => stopEngine, []);

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
    setProgress(null);
    setState({ kind: 'closed' });
  }

  async function scan(file: File) {
    const thisRun = ++run.current;
    setState({ kind: 'recognizing' });
    try {
      const [image, ocr] = await Promise.all([
        prepareLabelImage(file),
        ensureEngine(),
      ]);
      const layout = await ocr.recognize(image);
      if (thisRun !== run.current) return;
      setState({ kind: 'review', result: readLabel(layout) });
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

      {state.kind === 'review' && (
        <>
          <LabelReviewList result={state.result} />
          {state.appliedNote ? (
            <p className="text-body text-text-muted">{state.appliedNote}</p>
          ) : (
            <PrimaryButton
              type="button"
              className="self-start"
              disabled={state.result.outcome !== 'ok'}
              onClick={() => {
                setState({ ...state, appliedNote: onApply(state.result) });
              }}
            >
              Apply
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
