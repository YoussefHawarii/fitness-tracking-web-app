import { useState } from 'react';
import {
  deleteExerciseSession,
  updateExerciseSession,
  type ExerciseSession,
  type SportCatalogEntry,
  type SportType,
} from '../services/calorieBalanceService';
import { Input, FieldLabel, Select } from './ui/Input';
import { PrimaryButton, SecondaryButton } from './ui/Button';

interface Props {
  session: ExerciseSession;
  sportCatalog: SportCatalogEntry[];
  onChanged: () => void;
}

function sportLabel(session: ExerciseSession, sportCatalog: SportCatalogEntry[]): string {
  if (session.sportType === 'OTHER' && session.customSportName) {
    return session.customSportName;
  }
  return sportCatalog.find((s) => s.sportType === session.sportType)?.label ?? session.sportType;
}

export function ExerciseSessionCard({ session, sportCatalog, onChanged }: Props) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sportType, setSportType] = useState<SportType>(session.sportType);
  const [customSportName, setCustomSportName] = useState(session.customSportName ?? '');
  const [durationMinutes, setDurationMinutes] = useState(String(session.durationMinutes));

  async function handleSave() {
    const duration = Number(durationMinutes);
    if (!duration || duration < 1 || duration > 1440) return;
    if (sportType === 'OTHER' && !customSportName.trim()) return;

    setSubmitting(true);
    try {
      await updateExerciseSession(session.id, {
        sportType,
        customSportName: sportType === 'OTHER' ? customSportName.trim() : undefined,
        durationMinutes: duration,
      });
      setEditing(false);
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    setSubmitting(true);
    try {
      await deleteExerciseSession(session.id);
      onChanged();
    } finally {
      setSubmitting(false);
    }
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-4">
        <FieldLabel>
          Sport
          <Select value={sportType} onChange={(e) => setSportType(e.target.value as SportType)}>
            {sportCatalog.map((s) => (
              <option key={s.sportType} value={s.sportType}>
                {s.label}
              </option>
            ))}
          </Select>
        </FieldLabel>
        {sportType === 'OTHER' && (
          <FieldLabel>
            Activity name
            <Input value={customSportName} onChange={(e) => setCustomSportName(e.target.value)} />
          </FieldLabel>
        )}
        <FieldLabel>
          Duration (minutes)
          <Input
            type="number"
            min={1}
            max={1440}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(e.target.value)}
          />
        </FieldLabel>
        <div className="flex gap-2">
          <PrimaryButton onClick={handleSave} disabled={submitting}>
            Save
          </PrimaryButton>
          <SecondaryButton onClick={() => setEditing(false)} disabled={submitting}>
            Cancel
          </SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-surface-raised p-4">
      <div>
        <p className="text-body text-text">{sportLabel(session, sportCatalog)}</p>
        <p className="text-label text-text-muted">
          {session.durationMinutes} min · {Number(session.caloriesBurned).toFixed(0)} kcal
        </p>
      </div>
      {confirmingDelete ? (
        <div className="flex items-center gap-2">
          <span className="text-label text-text-muted">Delete?</span>
          <SecondaryButton onClick={handleDelete} disabled={submitting} className="px-3 py-1.5">
            Confirm
          </SecondaryButton>
          <SecondaryButton
            onClick={() => setConfirmingDelete(false)}
            disabled={submitting}
            className="px-3 py-1.5"
          >
            Cancel
          </SecondaryButton>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <SecondaryButton onClick={() => setEditing(true)} className="px-3 py-1.5">
            Edit
          </SecondaryButton>
          <SecondaryButton onClick={() => setConfirmingDelete(true)} className="px-3 py-1.5">
            Delete
          </SecondaryButton>
        </div>
      )}
    </div>
  );
}
