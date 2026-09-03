import { SecondaryButton } from '../../components/ui/Button';

interface Props {
  selectedDate: string;
  todayDate: string;
  onDateChange: (date: string) => void;
}

// Native date input rather than a custom calendar widget/library — see
// research.md's "Native <input type='date'> for the calendar control"
// decision. `max` enforces FR-002 (no future dates) at the browser level.
function openPickerOnClick(event: React.MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  // showPicker() is the standard API for opening a date input's calendar
  // dropdown from any click in the field, not just the small icon — see
  // research.md §1. Feature-detected and swallowed so unsupported/older
  // browsers silently fall back to the input's default click behavior.
  if (typeof input.showPicker === 'function') {
    try {
      input.showPicker();
    } catch {
      // Ignore — e.g. called outside a user gesture in some browsers.
    }
  }
}

export function HistoryDatePicker({
  selectedDate,
  todayDate,
  onDateChange,
}: Props) {
  const isToday = selectedDate === todayDate;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-label normal-case tracking-normal text-text-muted">
        <span>History</span>
        <input
          type="date"
          value={selectedDate}
          max={todayDate}
          onClick={openPickerOnClick}
          onChange={(event) => {
            if (event.target.value) onDateChange(event.target.value);
          }}
          className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-body text-text"
        />
      </label>
      {!isToday && (
        <SecondaryButton type="button" onClick={() => onDateChange(todayDate)}>
          Back to today
        </SecondaryButton>
      )}
    </div>
  );
}
