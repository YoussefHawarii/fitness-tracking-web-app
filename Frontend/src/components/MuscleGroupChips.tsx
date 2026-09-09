import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '../services/workoutService';
import { Pill } from './ui/Pill';

interface Props {
  selected: MuscleGroup[];
  onChange: (next: MuscleGroup[]) => void;
}

export function MuscleGroupChips({ selected, onChange }: Props) {
  function toggle(group: MuscleGroup) {
    if (selected.includes(group)) {
      onChange(selected.filter((g) => g !== group));
    } else {
      onChange([...selected, group]);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {MUSCLE_GROUPS.map((group) => (
        <Pill key={group} active={selected.includes(group)} onClick={() => toggle(group)}>
          {MUSCLE_GROUP_LABELS[group]}
        </Pill>
      ))}
    </div>
  );
}
