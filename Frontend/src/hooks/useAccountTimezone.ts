import { useEffect, useState } from 'react';
import { getGoals } from '../services/userService';

// `timezone` undefined (e.g. still loading) falls back to the host's own
// timezone, matching the app's previous browser-clock-based behavior.
function formatDateInTimezone(
  date: Date,
  timezone: string | undefined,
): string {
  // en-CA gives YYYY-MM-DD directly, avoiding manual part reassembly.
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(date);
}

function hourInTimezone(date: Date, timezone: string | undefined): number {
  const hourText = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }).format(date);
  // "24" is used by some environments for midnight instead of "00".
  return Number(hourText) % 24;
}

interface UseAccountTimezoneResult {
  timezone: string | null;
  loading: boolean;
  error: string | null;
  todayInAccountTimezone: () => string;
  currentHourInAccountTimezone: () => number;
}

export function useAccountTimezone(): UseAccountTimezoneResult {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getGoals()
      .then((profile) => {
        if (!cancelled) setTimezone(profile.timezone);
      })
      .catch(() => {
        if (!cancelled) setError('Could not load account timezone.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    timezone,
    loading,
    error,
    todayInAccountTimezone: () =>
      formatDateInTimezone(new Date(), timezone ?? undefined),
    currentHourInAccountTimezone: () =>
      hourInTimezone(new Date(), timezone ?? undefined),
  };
}
