import { useEffect, useState } from 'react';
import { getGoals, updateGoals, type ActivityLevel, type Baseline } from '../services/userService';
import { Card, SegmentedControl, StatusChip } from '../components/ui/Card';
import { Input, FieldLabel } from '../components/ui/Input';
import { PrimaryButton } from '../components/ui/Button';
import { useAccountContext } from '../context/AccountContext';
import { formatWeight } from '../utils/units';
import { getGoalDirection, GOAL_DIRECTION_LABEL } from '../utils/goalDirection';

function BarRow({ label, value, fraction }: { label: string; value: string; fraction: number }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-body">
        <span className="text-text-muted">{label}</span>
        <span className="text-readout">{value}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-accent-soft">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(Math.max(fraction, 0), 1) * 100}%` }}
        />
      </div>
    </div>
  );
}

export function Goals() {
  const { account } = useAccountContext();
  const unitsPreference = account?.unitsPreference ?? 'KG';
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [weightInput, setWeightInput] = useState('');
  const [goalInput, setGoalInput] = useState('');
  const [activity, setActivity] = useState<ActivityLevel>('LIGHTLY_ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getGoals()
      .then((data) => {
        setBaseline(data);
        setWeightInput(data.currentWeightKg);
        setGoalInput(data.goalWeightKg);
        setActivity(data.activityLevel);
      })
      .catch(() => setError('Complete onboarding to see your baseline.'));
  }, []);

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      const updated = await updateGoals({
        currentWeightKg: Number(weightInput),
        goalWeightKg: Number(goalInput),
        activityLevel: activity,
      });
      setBaseline(updated);
    } catch {
      setError('Could not update your baseline.');
    } finally {
      setSaving(false);
    }
  }

  if (error) {
    return <p className="p-6 text-body text-warn">{error}</p>;
  }

  if (!baseline) {
    return <p className="p-6 text-body text-text-muted">Loading…</p>;
  }

  const currentWeight = Number(weightInput || baseline.currentWeightKg);
  const goalWeight = Number(goalInput || baseline.goalWeightKg);
  const spanMax = Math.max(currentWeight, goalWeight, 1) * 1.15;
  const goalDirection = getGoalDirection(currentWeight, goalWeight);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-display">Your baseline</h1>

      <Card holo className="!bg-accent p-6 text-bg">
        <p className="text-label text-bg/70">Daily target</p>
        <p className="text-readout text-[36px]">{baseline.dailyCalorieTarget.toFixed(0)} kcal</p>
        <p className="text-body text-bg/80">
          Estimated maintenance {Number(baseline.tdee).toFixed(0)} · BMR {Number(baseline.bmr).toFixed(0)} kcal
        </p>
      </Card>

      <div>
        <p className="mb-2 text-label text-text-muted">Activity level</p>
        <SegmentedControl
          value={activity}
          onChange={setActivity}
          options={[
            { value: 'LIGHTLY_ACTIVE', label: 'Lightly active' },
            { value: 'MODERATELY_ACTIVE', label: 'Moderately active' },
            { value: 'VERY_ACTIVE', label: 'Very active' },
          ]}
        />
      </div>

      <Card className="flex flex-col gap-5 p-6">
        <BarRow
          label="Current weight"
          value={formatWeight(currentWeight, unitsPreference)}
          fraction={currentWeight / spanMax}
        />
        <BarRow
          label="Goal weight"
          value={formatWeight(goalWeight, unitsPreference)}
          fraction={goalWeight / spanMax}
        />
        <StatusChip className="self-start">{GOAL_DIRECTION_LABEL[goalDirection]}</StatusChip>

        <div className="grid grid-cols-2 gap-4">
          <FieldLabel>
            Current weight (kg)
            <Input type="number" value={weightInput} onChange={(e) => setWeightInput(e.target.value)} />
          </FieldLabel>
          <FieldLabel>
            Goal weight (kg)
            <Input type="number" value={goalInput} onChange={(e) => setGoalInput(e.target.value)} />
          </FieldLabel>
        </div>

        <PrimaryButton onClick={handleSave} disabled={saving} className="self-start">
          {saving ? 'Saving…' : 'Save changes'}
        </PrimaryButton>
      </Card>

      <Card className="grid grid-cols-3 divide-x divide-border p-0">
        <div className="p-5">
          <p className="text-readout text-lg">{baseline.age}</p>
          <p className="text-label text-text-muted">Age</p>
        </div>
        <div className="p-5">
          <p className="text-readout text-lg">{Number(baseline.heightCm).toFixed(0)} cm</p>
          <p className="text-label text-text-muted">Height</p>
        </div>
        <div className="p-5">
          <p className="text-readout text-lg">{baseline.sex === 'MALE' ? 'Male' : 'Female'}</p>
          <p className="text-label text-text-muted">Sex</p>
        </div>
      </Card>
    </div>
  );
}
