import { useEffect, useState } from 'react';
import { getWorkoutExerciseCatalog, type WorkoutExerciseCatalogEntry } from '../services/workoutService';
import { WorkoutSessionForm } from '../components/WorkoutSessionForm';
import { WorkoutHistoryTab } from '../components/WorkoutHistoryTab';
import { SegmentedControl } from '../components/ui/Card';

type Tab = 'log' | 'history';

export function Workouts() {
  const [tab, setTab] = useState<Tab>('log');
  const [catalog, setCatalog] = useState<WorkoutExerciseCatalogEntry[]>([]);

  useEffect(() => {
    getWorkoutExerciseCatalog().then(setCatalog);
  }, []);

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
        <WorkoutSessionForm catalog={catalog} />
      ) : (
        <WorkoutHistoryTab catalog={catalog} />
      )}
    </div>
  );
}
