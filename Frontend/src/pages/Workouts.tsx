import { useEffect, useMemo, useState } from 'react';
import {
  getWorkoutExerciseCatalog,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type WorkoutExerciseCatalogEntry,
} from '../services/workoutService';
import { MuscleGroupChips } from '../components/MuscleGroupChips';
import { Card, SegmentedControl } from '../components/ui/Card';
import { FieldLabel, Select } from '../components/ui/Input';

type Tab = 'log' | 'history';

export function Workouts() {
  const [tab, setTab] = useState<Tab>('log');
  const [catalog, setCatalog] = useState<WorkoutExerciseCatalogEntry[]>([]);
  const [selectedMuscleGroups, setSelectedMuscleGroups] = useState<MuscleGroup[]>([]);
  const [selectedExerciseType, setSelectedExerciseType] = useState('');

  useEffect(() => {
    getWorkoutExerciseCatalog().then(setCatalog);
  }, []);

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
    // Clear a picked exercise once it falls outside the new muscle-group
    // selection, so the picker never holds a value the dropdown no longer offers.
    const stillOffered = next.some((group) =>
      (catalogByGroup.get(group) ?? []).some((entry) => entry.exerciseType === selectedExerciseType),
    );
    if (!stillOffered) setSelectedExerciseType('');
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-display">Workouts</h1>

      <SegmentedControl
        options={[
          { value: 'log', label: 'Log Workout' },
          { value: 'history', label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'log' ? (
        <Card className="flex flex-col gap-4 p-6">
          <FieldLabel>
            Muscle groups trained
            <MuscleGroupChips selected={selectedMuscleGroups} onChange={handleMuscleGroupsChange} />
          </FieldLabel>

          <FieldLabel>
            Exercise
            <Select
              value={selectedExerciseType}
              onChange={(e) => setSelectedExerciseType(e.target.value)}
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
        </Card>
      ) : (
        <Card className="flex flex-col gap-2 p-6">
          <p className="text-body text-text-muted">
            Your workout history will appear here once you save your first session.
          </p>
        </Card>
      )}
    </div>
  );
}
