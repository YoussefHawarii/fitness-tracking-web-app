// "Daily" totals use midnight-to-midnight in the user's local timezone, not
// server time (docs/business-logic.md §7). Timestamps are stored in UTC;
// this converts a calendar date + IANA timezone into the UTC instant range
// that day covers.

export interface DayBoundary {
  startUtc: Date;
  endUtc: Date;
}

// Returns the UTC offset (in minutes) that `timezone` observes at `instant`.
function tzOffsetMinutes(instant: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf
    .formatToParts(instant)
    .reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return (asUtc - instant.getTime()) / 60000;
}

// `dateStr` is a calendar date ("YYYY-MM-DD") in the user's own timezone.
export function getDayBoundaryUtc(
  dateStr: string,
  timezone: string,
): DayBoundary {
  const [year, month, day] = dateStr.split('-').map(Number);
  // First approximate midnight as if it were UTC, then correct by that
  // instant's actual offset in the target timezone.
  const naiveUtcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0);
  const offsetMinutes = tzOffsetMinutes(new Date(naiveUtcMidnight), timezone);
  const startUtc = new Date(naiveUtcMidnight - offsetMinutes * 60000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc, endUtc };
}
