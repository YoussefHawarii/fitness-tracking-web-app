import { Input } from './ui/Input';
import { SecondaryButton } from './ui/Button';
import { formatWeight } from '../utils/units';
import { formatLocalDate } from '../utils/dates';
import type { Units } from '../services/accountService';
import type { LastLoggedExercise, WorkoutSet } from '../services/workoutService';

export interface DraftSet {
  id: string;
  reps: string;
  weightKg: string;
}

export interface DraftExercise {
  id: string;
  exerciseType: string;
  label: string;
  sets: DraftSet[];
}

interface Props {
  exercise: DraftExercise;
  lastLogged?: LastLoggedExercise | null;
  unitsPreference: Units;
  onRemove: () => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onUpdateSet: (setId: string, field: 'reps' | 'weightKg', value: string) => void;
}

const LAST_LOGGED_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

function formatLastSet(set: WorkoutSet, unitsPreference: Units): string {
  return set.weightKg != null
    ? `${set.reps} × ${formatWeight(Number(set.weightKg), unitsPreference)}`
    : `${set.reps} reps (bodyweight)`;
}

export function WorkoutExerciseEditor({
  exercise,
  lastLogged,
  unitsPreference,
  onRemove,
  onAddSet,
  onRemoveSet,
  onUpdateSet,
}: Props) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <span className="text-body text-text">{exercise.label}</span>
        <SecondaryButton className="px-3 py-1.5" onClick={onRemove}>
          Remove
        </SecondaryButton>
      </div>

      {lastLogged && (
        <p className="text-label text-text-muted">
          Last time ({formatLocalDate(lastLogged.loggedForDate, LAST_LOGGED_DATE_FORMAT)}):{' '}
          {lastLogged.sets.map((set) => formatLastSet(set, unitsPreference)).join(', ')}
        </p>
      )}

      <div className="flex items-center gap-3 text-label text-text-muted">
        <span className="flex-1">Reps</span>
        <span className="flex-1">Weight (kg)</span>
        <span className="w-9" />
      </div>

      {exercise.sets.map((set) => (
        <div key={set.id} className="flex items-center gap-3">
          <Input
            type="number"
            min={1}
            step={1}
            aria-label="Reps"
            className="flex-1"
            value={set.reps}
            onChange={(e) => onUpdateSet(set.id, 'reps', e.target.value)}
          />
          <Input
            type="number"
            min={0.01}
            step={0.01}
            aria-label="Weight in kilograms"
            placeholder="Bodyweight"
            className="flex-1"
            value={set.weightKg}
            onChange={(e) => onUpdateSet(set.id, 'weightKg', e.target.value)}
          />
          <SecondaryButton
            className="w-9 px-0 py-1.5"
            onClick={() => onRemoveSet(set.id)}
            disabled={exercise.sets.length === 1}
          >
            ×
          </SecondaryButton>
        </div>
      ))}

      <SecondaryButton className="self-start px-3 py-1.5" onClick={onAddSet}>
        + Add Set
      </SecondaryButton>
    </div>
  );
}
