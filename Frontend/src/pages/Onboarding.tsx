import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { submitOnboarding, type ActivityLevel, type Sex } from '../services/userService';
import { Card, SegmentedControl } from '../components/ui/Card';
import { Input, FieldLabel } from '../components/ui/Input';
import { PrimaryButton } from '../components/ui/Button';
import { getGoalDirection, GOAL_DIRECTION_LABEL } from '../utils/goalDirection';

// Backend wraps validation failures as { message: { message: string | string[] } }
// (see HttpExceptionFilter) — surface that instead of a one-size-fits-all
// message, since a 400 (bad values), 401 (expired session) and network
// failure all need different guidance and were previously indistinguishable.
function getOnboardingErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    if (!err.response) {
      return "Could not reach the server. Check your connection and try again.";
    }
    if (err.response.status === 401) {
      return 'Your session expired. Please log in again.';
    }
    if (err.response.status === 400) {
      const body = err.response.data?.message;
      const detail = typeof body === 'string' ? body : body?.message;
      const text = Array.isArray(detail) ? detail.join(' ') : detail;
      if (text) return text;
    }
  }
  return 'Could not save your details. Please check the values and try again.';
}

export function Onboarding() {
  const [age, setAge] = useState('');
  const [sex, setSex] = useState<Sex>('MALE');
  const [heightCm, setHeightCm] = useState('');
  const [currentWeightKg, setCurrentWeightKg] = useState('');
  const [goalWeightKg, setGoalWeightKg] = useState('');
  const [activityLevel, setActivityLevel] = useState<ActivityLevel>('LIGHTLY_ACTIVE');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      await submitOnboarding({
        age: Number(age),
        sex,
        heightCm: Number(heightCm),
        currentWeightKg: Number(currentWeightKg),
        goalWeightKg: Number(goalWeightKg),
        activityLevel,
        timezone,
      });
      navigate('/dashboard');
    } catch (err) {
      setError(getOnboardingErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div>
        <h1 className="text-display">Tell us about yourself</h1>
        <p className="mt-2 text-body text-text-muted">
          This sets your personal calorie baseline — a directional estimate, not a medical measurement.
        </p>
      </div>
      <Card className="p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldLabel>
              Age
              <Input type="number" required min={1} value={age} onChange={(e) => setAge(e.target.value)} />
            </FieldLabel>
            <FieldLabel>
              Height (cm)
              <Input type="number" required min={1} value={heightCm} onChange={(e) => setHeightCm(e.target.value)} />
            </FieldLabel>
          </div>

          <div>
            <p className="mb-2 text-body text-text">Sex</p>
            <SegmentedControl
              value={sex}
              onChange={setSex}
              options={[
                { value: 'MALE', label: 'Male' },
                { value: 'FEMALE', label: 'Female' },
              ]}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <FieldLabel>
              Current weight (kg)
              <Input
                type="number"
                required
                min={1}
                step={0.01}
                value={currentWeightKg}
                onChange={(e) => setCurrentWeightKg(e.target.value)}
              />
            </FieldLabel>
            <FieldLabel>
              Goal weight (kg)
              <Input
                type="number"
                required
                min={1}
                step={0.01}
                value={goalWeightKg}
                onChange={(e) => setGoalWeightKg(e.target.value)}
              />
            </FieldLabel>
          </div>

          {currentWeightKg && goalWeightKg && (
            <p className="text-body text-text-muted">
              Looks like you want to:{' '}
              <span className="text-text">
                {GOAL_DIRECTION_LABEL[getGoalDirection(Number(currentWeightKg), Number(goalWeightKg))]}
              </span>
            </p>
          )}

          <div>
            <p className="mb-2 text-body text-text">Activity level (non-exercise baseline)</p>
            <SegmentedControl
              value={activityLevel}
              onChange={setActivityLevel}
              options={[
                { value: 'LIGHTLY_ACTIVE', label: 'Lightly active' },
                { value: 'MODERATELY_ACTIVE', label: 'Moderately active' },
                { value: 'VERY_ACTIVE', label: 'Very active' },
              ]}
            />
          </div>

          {error && <p className="text-body text-warn">{error}</p>}
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Continue'}
          </PrimaryButton>
        </form>
      </Card>
    </div>
  );
}
