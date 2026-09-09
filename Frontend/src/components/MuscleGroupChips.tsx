import { MUSCLE_GROUPS, MUSCLE_GROUP_LABELS, type MuscleGroup } from '../services/workoutService';

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
      {MUSCLE_GROUPS.map((group) => {
        const isSelected = selected.includes(group);
        return (
          <button
            key={group}
            type="button"
            onClick={() => toggle(group)}
            aria-pressed={isSelected}
            className={`rounded-full border px-4 py-1.5 text-label normal-case tracking-[0.02em] transition ${
              isSelected
                ? 'border-accent bg-accent text-bg'
                : 'border-border bg-surface-raised text-text-muted hover:text-text'
            }`}
          >
            {MUSCLE_GROUP_LABELS[group]}
          </button>
        );
      })}
    </div>
  );
}
