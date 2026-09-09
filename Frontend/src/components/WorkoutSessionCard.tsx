import { useState } from 'react';
import {
  deleteWorkoutSession,
  exerciseLabel,
  getWorkoutSession,
  MUSCLE_GROUP_LABELS,
  type WorkoutExerciseCatalogEntry,
  type WorkoutSession,
} from '../services/workoutService';
import { WorkoutSessionForm } from './WorkoutSessionForm';
import { Card } from './ui/Card';
import { SecondaryButton } from './ui/Button';
import { formatLocalDate } from '../utils/dates';

interface Props {
  session: WorkoutSession;
  catalog: WorkoutExerciseCatalogEntry[];
  onChanged: () => void;
}

const SESSION_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

function formatSet(set: { reps: number; weightKg: string | null }): string {
  return set.weightKg != null ? `${set.reps} × ${set.weightKg} kg` : `${set.reps} reps (bodyweight)`;
}

export function WorkoutSessionCard({ session, catalog, onChanged }: Props) {
  const [editSession, setEditSession] = useState<WorkoutSession | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteWorkoutSession(session.id);
      onChanged();
    } catch {
      setError('Could not delete this workout. Try again.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleEditClick() {
    // Always re-fetch the full session — `session` here may be a
    // muscleGroup-filtered view (only a subset of its exercises), and
    // editing that directly would silently drop the hidden ones on save.
    setLoadingEdit(true);
    setError(null);
    try {
      setEditSession(await getWorkoutSession(session.id));
    } catch {
      setError('Could not open this workout for editing. Try again.');
    } finally {
      setLoadingEdit(false);
    }
  }

  if (editSession) {
    return (
      <WorkoutSessionForm
        catalog={catalog}
        initialSession={editSession}
        onSaved={() => {
          setEditSession(null);
          onChanged();
        }}
        onCancel={() => setEditSession(null)}
      />
    );
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-body text-text">
          {formatLocalDate(session.loggedForDate, SESSION_DATE_FORMAT)}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {session.muscleGroups.map((group) => (
            <span
              key={group}
              className="rounded-full bg-accent-soft px-3 py-1 text-label text-accent"
            >
              {MUSCLE_GROUP_LABELS[group]}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {session.exercises.map((exercise) => (
          <div key={exercise.id}>
            <p className="text-body text-text">{exerciseLabel(exercise.exerciseType, catalog)}</p>
            <p className="text-label text-text-muted">
              {exercise.sets.map(formatSet).join(', ')}
            </p>
          </div>
        ))}
      </div>

      {confirmingDelete ? (
        <div className="flex items-center gap-2">
          <span className="text-label text-text-muted">Delete?</span>
          <SecondaryButton onClick={handleDelete} disabled={deleting} className="px-3 py-1.5">
            Confirm
          </SecondaryButton>
          <SecondaryButton
            onClick={() => setConfirmingDelete(false)}
            disabled={deleting}
            className="px-3 py-1.5"
          >
            Cancel
          </SecondaryButton>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <SecondaryButton
            onClick={handleEditClick}
            disabled={loadingEdit}
            className="px-3 py-1.5"
          >
            Edit
          </SecondaryButton>
          <SecondaryButton onClick={() => setConfirmingDelete(true)} className="px-3 py-1.5">
            Delete
          </SecondaryButton>
        </div>
      )}

      {error && <p className="text-body text-warn">{error}</p>}
    </Card>
  );
}
