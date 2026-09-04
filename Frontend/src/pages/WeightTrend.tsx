import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts';
import {
  getPrediction,
  listWeighIns,
  logWeighIn,
  type PredictionResult,
  type WeighInWithComparison,
} from '../services/weightPredictionService';
import { Card, SegmentedControl } from '../components/ui/Card';
import { Input, FieldLabel } from '../components/ui/Input';
import { PrimaryButton } from '../components/ui/Button';
import { useAccountContext } from '../context/AccountContext';
import { formatWeight } from '../utils/units';

type Range = '30' | '90' | 'all';

function todayLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function WeightTrend() {
  const { account } = useAccountContext();
  const unitsPreference = account?.unitsPreference ?? 'KG';
  const [prediction, setPrediction] = useState<PredictionResult | null>(null);
  const [weighIns, setWeighIns] = useState<WeighInWithComparison[]>([]);
  const [weightInput, setWeightInput] = useState('');
  const [range, setRange] = useState<Range>('30');
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    getPrediction(todayLocalDate()).then(setPrediction);
    listWeighIns().then(setWeighIns).catch(() => setError('Could not load weigh-ins.'));
  }

  useEffect(refresh, []);

  async function handleLogWeighIn() {
    if (!weightInput) return;
    await logWeighIn(Number(weightInput), todayLocalDate());
    setWeightInput('');
    refresh();
  }

  const rangeDays = range === '30' ? 30 : range === '90' ? 90 : Infinity;

  const chartData = useMemo(() => {
    const chronological = [...weighIns].reverse();
    const mostRecent = chronological.at(-1)?.loggedForDate;
    const cutoff = mostRecent ? new Date(mostRecent).getTime() - rangeDays * 24 * 60 * 60 * 1000 : -Infinity;
    return chronological
      .filter((w) => rangeDays === Infinity || new Date(w.loggedForDate).getTime() >= cutoff)
      .map((w) => ({
        date: w.loggedForDate.slice(5, 10),
        actual: Number(w.weightKg),
        predicted: w.comparison?.predictedWeightKg ?? null,
      }));
  }, [weighIns, rangeDays]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <h1 className="text-display">Progress</h1>

      <SegmentedControl
        value={range}
        onChange={setRange}
        options={[
          { value: '30', label: '30 days' },
          { value: '90', label: '90 days' },
          { value: 'all', label: 'All' },
        ]}
      />

      <Card className="flex flex-col gap-4 p-6">
        <span className="text-label text-text-muted">Weight trend</span>
        {chartData.length > 0 ? (
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
                <YAxis domain={['auto', 'auto']} tick={{ fontSize: 12, fill: 'var(--color-text-muted)' }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 10,
                    border: '1px solid var(--color-border)',
                    background: 'var(--color-surface-raised)',
                    color: 'var(--color-text)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: 'var(--color-text-muted)' }}
                />
                <Line type="monotone" dataKey="actual" stroke="var(--color-accent)" strokeWidth={2.5} dot={false} name="Actual" />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="var(--color-text)"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  dot={false}
                  name="Projected"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-body text-text-muted">Log a few weigh-ins to see your trend.</p>
        )}
        <div className="flex items-center justify-between text-label text-text-muted">
          <span>Actual</span>
          <span>Projected</span>
        </div>
        {prediction?.insufficientData && (
          <p className="rounded-2xl bg-accent-soft p-3 text-body text-text-muted">{prediction.reason}</p>
        )}
        {prediction && !prediction.insufficientData && (
          <p className="text-body text-text-muted">
            Directional estimate: over the next {prediction.windowDays} days, your weight is trending
            toward{' '}
            <strong className="text-text">
              {prediction.predictedWeightKg != null
                ? formatWeight(prediction.predictedWeightKg, unitsPreference)
                : '—'}
            </strong>{' '}
            (
            {prediction.predictedWeightChangeKg && prediction.predictedWeightChangeKg > 0 ? '+' : ''}
            {prediction.predictedWeightChangeKg != null
              ? formatWeight(prediction.predictedWeightChangeKg, unitsPreference, 2)
              : '—'}
            ). Not medical advice.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card holo className="p-5">
          <p className="text-readout text-2xl">{weighIns.length}</p>
          <p className="text-label text-text-muted">Weigh-ins logged</p>
        </Card>
        <Card holo className="p-5">
          <p className="text-readout text-2xl">
            {chartData.length >= 2
              ? formatWeight(chartData[chartData.length - 1].actual - chartData[0].actual, unitsPreference)
              : '—'}
          </p>
          <p className="text-label text-text-muted">Change over range</p>
        </Card>
      </div>

      <Card className="flex items-end gap-3 p-6">
        <FieldLabel className="flex-1">
          Log today&apos;s weight (kg)
          <Input type="number" min={1} step={0.01} value={weightInput} onChange={(e) => setWeightInput(e.target.value)} />
        </FieldLabel>
        <PrimaryButton onClick={handleLogWeighIn}>Save</PrimaryButton>
      </Card>

      {error && <p className="text-body text-warn">{error}</p>}
    </div>
  );
}
