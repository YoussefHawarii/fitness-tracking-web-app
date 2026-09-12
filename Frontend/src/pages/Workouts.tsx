import { useEffect, useRef, useState } from 'react';
import { getWorkoutExerciseCatalog, type WorkoutExerciseCatalogEntry } from '../services/workoutService';
import { WorkoutSessionForm } from '../components/WorkoutSessionForm';
import { WorkoutHistoryTab } from '../components/WorkoutHistoryTab';
import { SegmentedControl } from '../components/ui/Card';

type Tab = 'log' | 'history';

export function Workouts() {
  const [tab, setTab] = useState<Tab>('log');
  const [catalog, setCatalog] = useState<WorkoutExerciseCatalogEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(false);
  const catalogRequestInFlightRef = useRef(false);
  const isMountedRef = useRef(false);

  function fetchCatalog() {
    if (catalogRequestInFlightRef.current) return;
    catalogRequestInFlightRef.current = true;

    getWorkoutExerciseCatalog()
      .then((data) => {
        if (isMountedRef.current) {
          setCatalog(data);
          setCatalogError(false);
        }
      })
      .catch(() => {
        if (isMountedRef.current) setCatalogError(true);
      })
      .finally(() => {
        catalogRequestInFlightRef.current = false;
        if (isMountedRef.current) setCatalogLoading(false);
      });
  }

  useEffect(() => {
    isMountedRef.current = true;
    void fetchCatalog();
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  function retryLoadCatalog() {
    if (catalogRequestInFlightRef.current) return;
    setCatalogLoading(true);
    setCatalogError(false);
    void fetchCatalog();
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

      {catalogError && (
        <p className="text-body text-warn">
          Could not load the exercise list.{' '}
          <button type="button" className="underline" onClick={retryLoadCatalog}>
            Retry
          </button>
        </p>
      )}

      {tab === 'log' ? (
        <WorkoutSessionForm catalog={catalog} catalogLoading={catalogLoading} />
      ) : (
        <WorkoutHistoryTab catalog={catalog} catalogLoading={catalogLoading} />
      )}
    </div>
  );
}
