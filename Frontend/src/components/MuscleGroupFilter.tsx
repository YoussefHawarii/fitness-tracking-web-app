import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '../services/workoutService';
import { Pill } from './ui/Pill';

interface Props {
  selected: MuscleGroup | null;
  onChange: (next: MuscleGroup | null) => void;
}

export function MuscleGroupFilter({ selected, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      <Pill active={selected === null} onClick={() => onChange(null)}>
        All
      </Pill>
      {MUSCLE_GROUPS.map((group) => (
        <Pill key={group} active={selected === group} onClick={() => onChange(group)}>
          {MUSCLE_GROUP_LABELS[group]}
        </Pill>
      ))}
    </div>
  );
}
