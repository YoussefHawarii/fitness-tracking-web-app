import { useCallback, useEffect, useState } from 'react';
import {
  listWorkoutSessions,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
  type WorkoutExerciseCatalogEntry,
  type WorkoutSession,
} from '../services/workoutService';
import { MuscleGroupFilter } from './MuscleGroupFilter';
import { WorkoutSessionCard } from './WorkoutSessionCard';
import { Card } from './ui/Card';
import { FieldLabel } from './ui/Input';

interface Props {
  catalog: WorkoutExerciseCatalogEntry[];
  catalogLoading: boolean;
}

export function WorkoutHistoryTab({ catalog, catalogLoading }: Props) {
  const [filter, setFilter] = useState<MuscleGroup | null>(null);
  const [sessions, setSessions] = useState<WorkoutSession[] | null>(null);

  const refresh = useCallback(() => {
    listWorkoutSessions(filter ?? undefined).then(setSessions);
  }, [filter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <FieldLabel>
        Filter by muscle group
        <MuscleGroupFilter selected={filter} onChange={setFilter} />
      </FieldLabel>

      {sessions === null ? (
        <p className="text-body text-text-muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-body text-text-muted">
          {filter
            ? `No ${MUSCLE_GROUP_LABELS[filter]} workouts logged yet.`
            : 'Your workout history will appear here once you save your first session.'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {sessions.map((session) => (
            <WorkoutSessionCard
              key={session.id}
              session={session}
              catalog={catalog}
              catalogLoading={catalogLoading}
              onChanged={refresh}
            />
          ))}
        </div>
      )}
    </Card>
  );
}
