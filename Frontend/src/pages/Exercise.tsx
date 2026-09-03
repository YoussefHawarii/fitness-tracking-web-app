import { useCallback, useEffect, useState } from 'react';
import {
  createExerciseSession,
  getSportCatalog,
  listExerciseSessions,
  type ExerciseSession,
  type SportCatalogEntry,
  type SportType,
} from '../services/calorieBalanceService';
import { ExerciseSessionCard } from '../components/ExerciseSessionCard';
import { Card } from '../components/ui/Card';
import { Input, FieldLabel, Select } from '../components/ui/Input';
import { PrimaryButton } from '../components/ui/Button';

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function Exercise() {
  const date = todayLocalDate();
  const [sportCatalog, setSportCatalog] = useState<SportCatalogEntry[]>([]);
  const [sessions, setSessions] = useState<ExerciseSession[]>([]);
  const [sportType, setSportType] = useState<SportType>('RUNNING');
  const [customSportName, setCustomSportName] = useState('');
  const [durationMinutes, setDurationMinutes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(() => {
    listExerciseSessions(date)
      .then(setSessions)
      .catch(() => setError('Could not load today’s exercise sessions.'));
  }, [date]);

  useEffect(() => {
    getSportCatalog().then(setSportCatalog);
    refresh();
  }, [refresh]);

  async function handleSubmit() {
    const duration = Number(durationMinutes);
    if (!duration || duration < 1 || duration > 1440) {
      setError('Enter a valid duration between 1 and 1440 minutes.');
      return;
    }
    if (sportType === 'OTHER' && !customSportName.trim()) {
      setError('Enter the name of the activity.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await createExerciseSession({
        sportType,
        customSportName: sportType === 'OTHER' ? customSportName.trim() : undefined,
        durationMinutes: duration,
        date,
      });
      setCustomSportName('');
      setDurationMinutes('');
      refresh();
    } catch {
      setError('Could not log this session. Make sure your profile setup is complete.');
    } finally {
      setSubmitting(false);
    }
  }

  const totalCalories = sessions.reduce((sum, s) => sum + Number(s.caloriesBurned), 0);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-display">Exercise</h1>

      <Card className="flex flex-col gap-4 p-6">
        <span className="text-label text-text-muted">Log a session</span>
        <FieldLabel>
          Sport
          <Select value={sportType} onChange={(e) => setSportType(e.target.value as SportType)}>
            {sportCatalog.map((s) => (
              <option key={s.sportType} value={s.sportType}>
                {s.label}
              </option>
            ))}
          </Select>
        </FieldLabel>
        {sportType === 'OTHER' && (
          <FieldLabel>
            Activity name
            <Input
              value={customSportName}
              onChange={(e) => setCustomSportName(e.target.value)}
              placeholder="e.g. Rock Climbing"
            />
          </FieldLabel>
        )}
        <FieldLabel>
          Duration (minutes)
          <Input
            type="number"
            min={1}
            max={1440}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </FieldLabel>
        <PrimaryButton onClick={handleSubmit} disabled={submitting}>
          Save session
        </PrimaryButton>
        {error && <p className="text-body text-warn">{error}</p>}
      </Card>

      <Card holo className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between">
          <span className="text-label text-text-muted">Today</span>
          <span className="text-readout text-lg">{totalCalories.toFixed(0)} kcal</span>
        </div>
        {sessions.length === 0 ? (
          <p className="text-body text-text-muted">No exercise sessions logged yet today.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((session) => (
              <ExerciseSessionCard
                key={session.id}
                session={session}
                sportCatalog={sportCatalog}
                onChanged={refresh}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
