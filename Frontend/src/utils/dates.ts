// Parses a `YYYY-MM-DD` string as a local calendar date, not UTC, so
// formatting it never shifts a day depending on the browser's own offset.
export function formatLocalDate(dateStr: string, options: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, options);
}
