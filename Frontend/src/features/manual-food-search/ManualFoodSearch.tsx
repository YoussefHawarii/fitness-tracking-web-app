import { useState } from 'react';
import {
  createLocalFoodItem,
  searchUsda,
  type LocalFoodItem,
  type UsdaFoodMatch,
} from '../../services/foodService';
import { FieldLabel, Input } from '../../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';

interface Props {
  onMatchSelected: (match: UsdaFoodMatch) => void;
  onLocalItemCreated: (item: LocalFoodItem) => void;
}

export function ManualFoodSearch({ onMatchSelected, onLocalItemCreated }: Props) {
  const [term, setTerm] = useState('');
  const [matches, setMatches] = useState<UsdaFoodMatch[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showFallback, setShowFallback] = useState(false);
  const [fallbackName, setFallbackName] = useState('');
  const [fallbackCalories, setFallbackCalories] = useState('');

  async function handleSearch() {
    if (!term.trim()) return;
    setError(null);
    setMatches(null);
    setShowFallback(false);
    try {
      const results = await searchUsda(term);
      setSearched(true);
      setMatches(results);
    } catch {
      setError('Search failed. Try again.');
    }
  }

  async function handleCreateFallbackItem() {
    if (!fallbackName.trim() || !fallbackCalories.trim() || Number.isNaN(Number(fallbackCalories))) {
      setError('Name is required and calories must be a number.');
      return;
    }
    try {
      const item = await createLocalFoodItem({
        name: fallbackName,
        caloriesPer100g: Number(fallbackCalories),
      });
      setError(null);
      onLocalItemCreated(item);
    } catch {
      setError('Could not create this item.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <FieldLabel>
        Food name
        <Input
          placeholder="e.g. Grilled chicken"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
        />
      </FieldLabel>
      <SecondaryButton type="button" disabled={!term.trim()} onClick={handleSearch} className="self-start">
        Search
      </SecondaryButton>

      {error && <p className="text-body text-warn">{error}</p>}

      {matches && matches.length > 0 && (
        <ul className="flex flex-col gap-2">
          {matches.map((match) => (
            <li key={match.fdcId}>
              <button
                type="button"
                onClick={() => onMatchSelected(match)}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-left text-body hover:bg-accent-soft"
              >
                {match.name} — {match.caloriesPer100g} kcal/100g
              </button>
            </li>
          ))}
        </ul>
      )}

      {searched && matches && matches.length === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-body text-text-muted">No matches found for "{term}".</p>
          {!showFallback && (
            <SecondaryButton type="button" onClick={() => setShowFallback(true)} className="self-start">
              Add as custom item
            </SecondaryButton>
          )}
        </div>
      )}

      {showFallback && (
        <div className="flex flex-col gap-3 border-t border-border pt-3">
          <FieldLabel>
            Food name
            <Input
              placeholder="e.g. Grandma's lasagna"
              value={fallbackName}
              onChange={(e) => setFallbackName(e.target.value)}
            />
          </FieldLabel>
          <FieldLabel>
            Calories per 100g
            <Input
              placeholder="165"
              value={fallbackCalories}
              onChange={(e) => setFallbackCalories(e.target.value)}
            />
          </FieldLabel>
          <PrimaryButton type="button" onClick={handleCreateFallbackItem} className="self-start">
            Use this item
          </PrimaryButton>
        </div>
      )}
    </div>
  );
}
