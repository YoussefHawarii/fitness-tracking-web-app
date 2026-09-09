import { useMemo, useState } from 'react';
import {
  createWorkoutSession,
  exerciseLabel,
  updateWorkoutSession,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type WorkoutExerciseCatalogEntry,
  type WorkoutSession,
} from '../services/workoutService';
import { MuscleGroupChips } from './MuscleGroupChips';
import { WorkoutExerciseEditor, type DraftExercise, type DraftSet } from './WorkoutExerciseEditor';
import { Card } from './ui/Card';
import { FieldLabel, Input, Select } from './ui/Input';
import { PrimaryButton, SecondaryButton } from './ui/Button';

interface Props {
  catalog: WorkoutExerciseCatalogEntry[];
  initialSession?: WorkoutSession;
  onSaved?: () => void;
  onCancel?: () => void;
}

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function newId(): string {
  return crypto.randomUUID();
}

function emptySet(): DraftSet {
  return { id: newId(), reps: '', weightKg: '' };
}

function draftExercisesFrom(
  session: WorkoutSession,
  catalog: WorkoutExerciseCatalogEntry[],
): DraftExercise[] {
  return session.exercises.map((exercise) => ({
    id: newId(),
    exerciseType: exercise.exerciseType,
    label: exerciseLabel(exercise.exerciseType, catalog),
    sets: exercise.sets.map((set) => ({
      id: newId(),
      reps: String(set.reps),
      weightKg: set.weightKg ?? '',
    })),
  }));
}

export function WorkoutSessionForm({ catalog, initialSession, onSaved, onCancel }: Props) {
  const isEditing = initialSession != null;

  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<MuscleGroup[]>(
    initialSession?.muscleGroups ?? [],
  );
  const [selectedExerciseType, setSelectedExerciseType] = useState('');
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>(
    initialSession ? draftExercisesFrom(initialSession, catalog) : [],
  );
  const [date, setDate] = useState(initialSession?.loggedForDate.slice(0, 10) ?? todayLocalDate());
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const catalogByGroup = useMemo(() => {
    const map = new Map<MuscleGroup, WorkoutExerciseCatalogEntry[]>();
    for (const entry of catalog) {
      const list = map.get(entry.muscleGroup) ?? [];
      list.push(entry);
      map.set(entry.muscleGroup, list);
    }
    return map;
  }, [catalog]);

  function handleMuscleGroupsChange(next: MuscleGroup[]) {
    setSelectedMuscleGroups(next);
    setSaved(false);
    // Clear a picked-but-not-yet-added exercise once it falls outside the
    // new muscle-group selection, so the picker never holds a value the
    // dropdown no longer offers.
    const stillOffered = next.some((group) =>
      (catalogByGroup.get(group) ?? []).some((entry) => entry.exerciseType === selectedExerciseType),
    );
    if (!stillOffered) setSelectedExerciseType('');
  }

  function handleExercisePicked(exerciseType: string) {
    if (!exerciseType) return;
    const entry = catalog.find((e) => e.exerciseType === exerciseType);
    if (!entry) return;
    setDraftExercises((prev) => [
      ...prev,
      { id: newId(), exerciseType: entry.exerciseType, label: entry.label, sets: [emptySet()] },
    ]);
    setSelectedExerciseType('');
    setSaved(false);
  }

  function removeExercise(exerciseId: string) {
    setDraftExercises((prev) => prev.filter((exercise) => exercise.id !== exerciseId));
  }

  function addSet(exerciseId: string) {
    setDraftExercises((prev) =>
      prev.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, sets: [...exercise.sets, emptySet()] }
          : exercise,
      ),
    );
  }

  function removeSet(exerciseId: string, setId: string) {
    setDraftExercises((prev) =>
      prev.map((exercise) =>
        exercise.id === exerciseId
          ? { ...exercise, sets: exercise.sets.filter((set) => set.id !== setId) }
          : exercise,
      ),
    );
  }

  function updateSet(exerciseId: string, setId: string, field: 'reps' | 'weightKg', value: string) {
    setDraftExercises((prev) =>
      prev.map((exercise) =>
        exercise.id === exerciseId
          ? {
              ...exercise,
              sets: exercise.sets.map((set) =>
                set.id === setId ? { ...set, [field]: value } : set,
              ),
            }
          : exercise,
      ),
    );
  }

  async function handleSave() {
    if (selectedMuscleGroups.length === 0) {
      setError('Select at least one muscle group.');
      return;
    }
    if (draftExercises.length === 0) {
      setError('Add at least one exercise.');
      return;
    }

    for (const exercise of draftExercises) {
      for (const set of exercise.sets) {
        const reps = Number(set.reps);
        if (!Number.isInteger(reps) || reps < 1) {
          setError(`Enter a valid rep count for ${exercise.label}.`);
          return;
        }
        const trimmedWeight = set.weightKg.trim();
        if (trimmedWeight) {
          const weight = Number(trimmedWeight);
          const isValidFormat = /^\d+(\.\d{1,2})?$/.test(trimmedWeight);
          if (!isValidFormat || weight <= 0) {
            setError(
              `Enter a valid weight (up to 2 decimal places) for ${exercise.label}, or leave it blank for a bodyweight set.`,
            );
            return;
          }
        }
      }
    }

    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        date,
        muscleGroups: selectedMuscleGroups,
        exercises: draftExercises.map((exercise) => ({
          exerciseType: exercise.exerciseType,
          sets: exercise.sets.map((set) => ({
            reps: Number(set.reps),
            weightKg: set.weightKg.trim() ? Number(set.weightKg) : undefined,
          })),
        })),
      };

      if (initialSession) {
        await updateWorkoutSession(initialSession.id, payload);
      } else {
        await createWorkoutSession(payload);
        setSelectedMuscleGroups([]);
        setDraftExercises([]);
        setDate(todayLocalDate());
        setSaved(true);
      }
      onSaved?.();
    } catch {
      setError('Could not save this workout. Check your entries and try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-6">
      <FieldLabel>
        Muscle groups trained
        <MuscleGroupChips selected={selectedMuscleGroups} onChange={handleMuscleGroupsChange} />
      </FieldLabel>

      <FieldLabel>
        Date
        <Input
          type="date"
          value={date}
          max={todayLocalDate()}
          onChange={(e) => setDate(e.target.value)}
        />
      </FieldLabel>

      <FieldLabel>
        Add an exercise
        <Select
          value={selectedExerciseType}
          onChange={(e) => handleExercisePicked(e.target.value)}
          disabled={selectedMuscleGroups.length === 0}
        >
          <option value="" disabled>
            {selectedMuscleGroups.length === 0
              ? 'Select a muscle group above'
              : 'Choose an exercise'}
          </option>
          {selectedMuscleGroups.map((group) => (
            <optgroup key={group} label={MUSCLE_GROUP_LABELS[group]}>
              {(catalogByGroup.get(group) ?? []).map((entry) => (
                <option key={entry.exerciseType} value={entry.exerciseType}>
                  {entry.label}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      </FieldLabel>

      {draftExercises.map((exercise) => (
        <WorkoutExerciseEditor
          key={exercise.id}
          exercise={exercise}
          onRemove={() => removeExercise(exercise.id)}
          onAddSet={() => addSet(exercise.id)}
          onRemoveSet={(setId) => removeSet(exercise.id, setId)}
          onUpdateSet={(setId, field, value) => updateSet(exercise.id, setId, field, value)}
        />
      ))}

      <div className="flex gap-2">
        <PrimaryButton onClick={handleSave} disabled={submitting}>
          {isEditing ? 'Save Changes' : 'Save Workout'}
        </PrimaryButton>
        {onCancel && (
          <SecondaryButton onClick={onCancel} disabled={submitting}>
            Cancel
          </SecondaryButton>
        )}
      </div>

      {error && <p className="text-body text-warn">{error}</p>}
      {saved && !error && <p className="text-body text-accent">Workout saved.</p>}
    </Card>
  );
}
