import type {
  LabelFieldConflict,
  RequiredFormField,
} from '../add-product/extractionFormValues';
import type { LabelField, LabelReading, LabelScanResult } from './labelReader';
import type { BBox } from './ocrLayout';
import { LABEL_FIELD_NAMES } from './labelFieldNames';

// The review step of a Label scan: every Label reading with its status,
// warnings, conversion and Label evidence (the row as read and where it
// sits on the photo), a choice of which readings to apply, conflicts with
// what the user entered, and the required fields still missing. The photo
// shown here exists only in memory for as long as the review is open.

const REQUIRED_FIELD_NAMES: Record<RequiredFormField, string> = {
  name: 'Product name',
  basis: 'Nutrition basis',
  caloriesPer100g: 'Calories',
  proteinPer100g: 'Protein',
  carbsPer100g: 'Carbs',
  fatPer100g: 'Fat',
};

const CONVERSION_TEXT = {
  'from-kj': 'converted from kJ',
  'from-g': 'printed in g, shown in mg',
} as const;

const STATUS_TEXT: Record<LabelReading['status'], string> = {
  read: '✓ read',
  'needs-check': '⚠ needs check',
  'not-found': '— not found',
};

export interface ReviewImage {
  url: string;
  width: number;
  height: number;
}

const THUMBNAIL_WIDTH = 240;

// A strip of the photo around a reading's words, with them outlined.
function EvidenceThumbnail({ image, box }: { image: ReviewImage; box: BBox }) {
  const pad = Math.max(8, box.y1 - box.y0);
  const x0 = Math.max(0, box.x0 - 2 * pad);
  const y0 = Math.max(0, box.y0 - pad);
  const x1 = Math.min(image.width, box.x1 + 2 * pad);
  const y1 = Math.min(image.height, box.y1 + pad);
  const scale = THUMBNAIL_WIDTH / Math.max(1, x1 - x0);
  return (
    <div
      aria-hidden="true"
      className="relative overflow-hidden rounded-md border border-border"
      style={{
        width: THUMBNAIL_WIDTH,
        height: Math.round((y1 - y0) * scale),
        backgroundImage: `url(${image.url})`,
        backgroundSize: `${image.width * scale}px ${image.height * scale}px`,
        backgroundPosition: `${-x0 * scale}px ${-y0 * scale}px`,
      }}
    >
      <div
        className="absolute rounded-sm border-2 border-accent"
        style={{
          left: (box.x0 - x0) * scale,
          top: (box.y0 - y0) * scale,
          width: (box.x1 - box.x0) * scale,
          height: (box.y1 - box.y0) * scale,
        }}
      />
    </div>
  );
}

function readingValue(reading: LabelReading): string {
  if (reading.value !== undefined) {
    return `${reading.value} ${reading.unit ?? ''}`.trim();
  }
  if (reading.conflictingValues) {
    return `${reading.conflictingValues.join(' or ')}?`;
  }
  return '—';
}

interface Props {
  result: LabelScanResult;
  image?: ReviewImage;
  // Readings that can be applied; others are shown for reference only.
  applicable: ReadonlySet<LabelField>;
  selected: ReadonlySet<LabelField>;
  onToggle: (field: LabelField) => void;
  conflicts: readonly LabelFieldConflict[];
  missingRequired: readonly RequiredFormField[];
}

export function LabelReview({
  result,
  image,
  applicable,
  selected,
  onToggle,
  conflicts,
  missingRequired,
}: Props) {
  return (
    <div className="flex flex-col gap-3">
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

      <ul className="flex flex-col gap-3">
        {result.readings.map((reading) => (
          <li
            key={reading.field}
            className="flex flex-col gap-1 border-b border-border pb-2 text-body text-text"
          >
            <label className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2">
                {applicable.has(reading.field) && (
                  <input
                    type="checkbox"
                    checked={selected.has(reading.field)}
                    onChange={() => onToggle(reading.field)}
                    aria-label={`Apply ${LABEL_FIELD_NAMES[reading.field]}`}
                  />
                )}
                {LABEL_FIELD_NAMES[reading.field]}
              </span>
              <span>
                {readingValue(reading)}
                {reading.conversion &&
                  ` (${CONVERSION_TEXT[reading.conversion]})`}
              </span>
              <span className="text-text-muted">
                {STATUS_TEXT[reading.status]}
                {reading.confirmedInBothLanguages && ' · English & Arabic'}
              </span>
            </label>
            {reading.warnings.map((warning) => (
              <p key={warning} className="text-label normal-case text-warn">
                {warning}
              </p>
            ))}
            {reading.evidence && (
              <div className="flex flex-col gap-1">
                <p
                  className="text-label normal-case text-text-muted"
                  dir="auto"
                >
                  Read from: “{reading.evidence.rowText}”
                </p>
                {image && (
                  <EvidenceThumbnail
                    image={image}
                    box={reading.evidence.bbox}
                  />
                )}
              </div>
            )}
          </li>
        ))}
      </ul>

      {conflicts.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-body text-warn">
            Not applied — you already entered a different value:
          </p>
          <ul className="flex flex-col gap-1 text-body text-text">
            {conflicts.map((c) => (
              <li key={c.field}>
                {LABEL_FIELD_NAMES[c.field]}: label says {c.label}, you entered{' '}
                {c.form}
              </li>
            ))}
          </ul>
        </div>
      )}

      {missingRequired.length > 0 && (
        <p className="text-body text-text-muted">
          Still needed before you can create the product:{' '}
          {missingRequired.map((f) => REQUIRED_FIELD_NAMES[f]).join(', ')}.
        </p>
      )}
    </div>
  );
}
