import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getDailyBalance,
  listExerciseSessions,
  type DailyBalance,
  type ExerciseSession,
} from '../services/calorieBalanceService';
import { listFoodLogsForDay, type FoodLogEntry } from '../services/foodService';
import { useAccountTimezone } from '../hooks/useAccountTimezone';
import { HistoryDatePicker } from '../features/dashboard-history/HistoryDatePicker';
import { Card } from '../components/ui/Card';
import { ProgressRing } from '../components/ui/ProgressRing';
import { SecondaryButton } from '../components/ui/Button';
import { MicIcon, PlusCircleIcon, ScanIcon } from '../components/ui/icons';

function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDisplayDate(dateStr: string): string {
  // dateStr is YYYY-MM-DD; parse as local calendar date, not UTC, so it
  // doesn't shift a day depending on the browser's own offset.
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });
}

// Remembers the selected history date for the rest of the browser tab's
// session (FR-013) — so navigating to another page and back restores it —
// without persisting across a closed tab or a fresh browser session.
const SELECTED_DATE_STORAGE_KEY = 'dashboard.selectedDate';

function readStoredSelectedDate(): string | null {
  try {
    return sessionStorage.getItem(SELECTED_DATE_STORAGE_KEY);
  } catch {
    return null; // sessionStorage unavailable (e.g. private browsing) — fall back to today
  }
}

export function Dashboard() {
  const {
    todayInAccountTimezone,
    currentHourInAccountTimezone,
    loading: timezoneLoading,
  } = useAccountTimezone();

  // `selectedDateOverride` is only ever set by the user explicitly picking a
  // date (or "back to today"), seeded once from sessionStorage; the default
  // ("today") is derived on every render instead of being seeded via an
  // effect, so no effect needs to call setState synchronously just to
  // initialize it.
  const [selectedDateOverride, setSelectedDateOverride] = useState<
    string | null
  >(readStoredSelectedDate);
  const todayDate = timezoneLoading ? null : todayInAccountTimezone();
  const selectedDate = selectedDateOverride ?? todayDate;

  useEffect(() => {
    try {
      if (selectedDateOverride) {
        sessionStorage.setItem(SELECTED_DATE_STORAGE_KEY, selectedDateOverride);
      } else {
        sessionStorage.removeItem(SELECTED_DATE_STORAGE_KEY);
      }
    } catch {
      // sessionStorage unavailable — persistence is best-effort only
    }
  }, [selectedDateOverride]);

  const [balance, setBalance] = useState<DailyBalance | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [foodEntries, setFoodEntries] = useState<FoodLogEntry[] | null>(null);
  const [foodLoading, setFoodLoading] = useState(false);
  const [foodError, setFoodError] = useState<string | null>(null);

  const [exerciseSessions, setExerciseSessions] = useState<
    ExerciseSession[] | null
  >(null);
  const [exerciseLoading, setExerciseLoading] = useState(false);
  const [exerciseError, setExerciseError] = useState<string | null>(null);

  // Resetting to null + loading=true is deferred a microtask via
  // Promise.resolve().then(...) rather than called synchronously at the top
  // of these functions, so the effect below never sets state synchronously
  // within its own call stack (react-hooks/set-state-in-effect) — the actual
  // reset-then-replace behavior (FR-009) is unchanged.
  const refreshBalance = useCallback(() => {
    if (!selectedDate) return;
    const date = selectedDate;
    Promise.resolve()
      .then(() => {
        setBalance(null);
        setBalanceError(null);
        setBalanceLoading(true);
      })
      .then(() => getDailyBalance(date))
      .then(setBalance)
      .catch(() => setBalanceError("Could not load that day's balance."))
      .finally(() => setBalanceLoading(false));
  }, [selectedDate]);

  const refreshFood = useCallback(() => {
    if (!selectedDate) return;
    const date = selectedDate;
    Promise.resolve()
      .then(() => {
        setFoodEntries(null);
        setFoodError(null);
        setFoodLoading(true);
      })
      .then(() => listFoodLogsForDay(date))
      .then(setFoodEntries)
      .catch(() => setFoodError("Could not load that day's food log."))
      .finally(() => setFoodLoading(false));
  }, [selectedDate]);

  const refreshExercise = useCallback(() => {
    if (!selectedDate) return;
    const date = selectedDate;
    Promise.resolve()
      .then(() => {
        setExerciseSessions(null);
        setExerciseError(null);
        setExerciseLoading(true);
      })
      .then(() => listExerciseSessions(date))
      .then(setExerciseSessions)
      .catch(() => setExerciseError("Could not load that day's exercise log."))
      .finally(() => setExerciseLoading(false));
  }, [selectedDate]);

  useEffect(() => {
    refreshBalance();
    refreshFood();
    refreshExercise();
  }, [refreshBalance, refreshFood, refreshExercise]);

  const remaining = balance
    ? Math.max(balance.dailyCalorieTarget - balance.caloriesConsumed, 0)
    : 0;
  const isToday = selectedDate === todayDate;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-body text-text-muted">
            {selectedDate ? formatDisplayDate(selectedDate) : ''}
          </p>
          <h1 className="text-display">
            {greetingForHour(currentHourInAccountTimezone())}
          </h1>
          <p className="text-label normal-case tracking-normal text-text-muted">
            {selectedDate
              ? `Showing: ${isToday ? 'Today' : formatDisplayDate(selectedDate)}`
              : ''}
          </p>
        </div>

        {selectedDate && todayDate && (
          <HistoryDatePicker
            selectedDate={selectedDate}
            todayDate={todayDate}
            onDateChange={setSelectedDateOverride}
          />
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_auto]">
        <Card holo className="flex flex-col gap-5 p-6">
          <div className="grid grid-cols-3 gap-3">
            <Link
              to="/food-log"
              state={{ mode: 'barcode' }}
              className="hud-frame flex flex-col items-center gap-2 rounded-xl bg-accent px-3 py-4 text-bg"
            >
              <ScanIcon width={20} height={20} />
              <span className="text-label normal-case tracking-normal">
                Scan
              </span>
            </Link>
            <Link
              to="/food-log"
              state={{ mode: 'voice' }}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-4"
            >
              <MicIcon width={20} height={20} />
              <span className="text-label normal-case tracking-normal">
                Voice
              </span>
            </Link>
            <Link
              to="/food-log"
              state={{ mode: 'manual' }}
              className="flex flex-col items-center gap-2 rounded-xl border border-border bg-surface-raised px-3 py-4"
            >
              <PlusCircleIcon width={20} height={20} />
              <span className="text-label normal-case tracking-normal">
                Manual
              </span>
            </Link>
          </div>

          {balanceLoading && (
            <p className="text-body text-text-muted">Loading balance…</p>
          )}
          {balanceError && (
            <div className="flex items-center justify-between rounded-xl border border-warn/40 bg-surface-raised p-4 text-body text-warn">
              <span>{balanceError}</span>
              <SecondaryButton type="button" onClick={refreshBalance}>
                Retry
              </SecondaryButton>
            </div>
          )}
          {balance && (
            <dl className="grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface-raised p-4 text-body sm:grid-cols-4">
              <div>
                <dt className="text-label text-text-muted">Consumed</dt>
                <dd className="text-readout text-lg">
                  {balance.caloriesConsumed.toFixed(0)}
                </dd>
              </div>
              <div>
                <dt className="text-label text-text-muted">Expended</dt>
                <dd className="text-readout text-lg">
                  {balance.caloriesExpended.toFixed(0)}
                </dd>
              </div>
              <div>
                <dt className="text-label text-text-muted">Exercise</dt>
                <dd className="text-readout text-lg">
                  {balance.caloriesBurnedExercise.toFixed(0)}
                </dd>
              </div>
              <div>
                <dt className="text-label text-text-muted">Balance</dt>
                <dd
                  className={`text-readout text-lg ${balance.balance < 0 ? 'text-accent' : 'text-warn'}`}
                >
                  {balance.balance > 0 ? '+' : ''}
                  {balance.balance.toFixed(0)} kcal (
                  {balance.balance < 0 ? 'deficit' : 'surplus'})
                </dd>
              </div>
            </dl>
          )}

          <section className="flex flex-col gap-2">
            <h2 className="text-label text-text-muted">Food logged</h2>
            {foodLoading && (
              <p className="text-body text-text-muted">Loading food log…</p>
            )}
            {foodError && (
              <div className="flex items-center justify-between rounded-xl border border-warn/40 bg-surface-raised p-4 text-body text-warn">
                <span>{foodError}</span>
                <SecondaryButton type="button" onClick={refreshFood}>
                  Retry
                </SecondaryButton>
              </div>
            )}
            {foodEntries && foodEntries.length === 0 && (
              <p className="rounded-xl border border-border bg-surface-raised p-4 text-body text-text-muted">
                Nothing logged for this day.
              </p>
            )}
            {foodEntries && foodEntries.length > 0 && (
              <ul className="flex flex-col gap-2">
                {foodEntries.map((entry) => (
                  <li key={entry.id}>
                    <Link
                      to={`/food-log?date=${selectedDate}`}
                      className="flex items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3 text-body transition hover:border-accent"
                    >
                      <span>{entry.name || 'Food item'}</span>
                      <span className="text-text-muted">
                        {Number(entry.caloriesComputed).toFixed(0)} kcal
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-label text-text-muted">Exercise logged</h2>
            {exerciseLoading && (
              <p className="text-body text-text-muted">Loading exercise log…</p>
            )}
            {exerciseError && (
              <div className="flex items-center justify-between rounded-xl border border-warn/40 bg-surface-raised p-4 text-body text-warn">
                <span>{exerciseError}</span>
                <SecondaryButton type="button" onClick={refreshExercise}>
                  Retry
                </SecondaryButton>
              </div>
            )}
            {exerciseSessions && exerciseSessions.length === 0 && (
              <p className="rounded-xl border border-border bg-surface-raised p-4 text-body text-text-muted">
                Nothing logged for this day.
              </p>
            )}
            {exerciseSessions && exerciseSessions.length > 0 && (
              <ul className="flex flex-col gap-2">
                {exerciseSessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3 text-body"
                  >
                    <span>
                      {session.customSportName || session.sportType} ·{' '}
                      {session.durationMinutes} min
                    </span>
                    <span className="text-text-muted">
                      {Number(session.caloriesBurned).toFixed(0)} kcal
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Link
            to="/exercise"
            className="flex items-center justify-center rounded-xl border border-border bg-surface-raised px-4 py-3 text-label normal-case tracking-normal text-text transition hover:border-accent hover:text-accent"
          >
            Log or edit exercise
          </Link>
        </Card>

        {balance && (
          <Card
            holo
            className="flex flex-col items-center justify-center gap-2 p-6"
          >
            <ProgressRing
              value={remaining}
              max={balance.dailyCalorieTarget}
              label={remaining.toFixed(0)}
              sublabel="kcal remaining"
            />
            <p className="text-label text-text-muted">
              {balance.caloriesConsumed.toFixed(0)} of{' '}
              {balance.dailyCalorieTarget.toFixed(0)}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}
