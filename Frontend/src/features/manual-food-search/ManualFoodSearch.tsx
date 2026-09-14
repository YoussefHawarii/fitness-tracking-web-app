import { useEffect, useState } from 'react';
import {
  createLocalFoodItem,
  searchFood,
  type FoodMatch,
  type LocalFoodItem,
} from '../../services/foodService';
import { FieldLabel, Input } from '../../components/ui/Input';
import { PrimaryButton, SecondaryButton } from '../../components/ui/Button';

interface Props {
  onMatchSelected: (match: FoodMatch) => void;
  onLocalItemCreated: (item: LocalFoodItem) => void;
  // Pre-fills the search box and runs the search once on mount for callers
  // that already have a genuine food-name search term.
  initialQuery?: string;
}

export function ManualFoodSearch({ onMatchSelected, onLocalItemCreated, initialQuery }: Props) {
  const [term, setTerm] = useState(initialQuery ?? '');
  const [matches, setMatches] = useState<FoodMatch[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showFallback, setShowFallback] = useState(false);
  const [fallbackName, setFallbackName] = useState('');
  const [fallbackCalories, setFallbackCalories] = useState('');

  useEffect(() => {
    if (initialQuery?.trim()) {
      handleSearch();
    }
    // Mount-only: this component remounts fresh every time the user enters
    // Manual mode (it's conditionally rendered in FoodLog.tsx), so there's
    // no case where `initialQuery` changes under an already-mounted instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSearch() {
    if (!term.trim()) return;
    setError(null);
    setMatches(null);
    setShowFallback(false);
    try {
      const result = await searchFood(term);
      setSearched(true);
      if (result.type === 'single') {
        // Exactly one recognized item — per the user's ask, skip the
        // candidate-list step entirely and go straight to entering grams.
        // See docs/food-log-input-modes-diagnosis.md §3.4 item 3.
        onMatchSelected(result.match);
        setMatches(null);
        return;
      }
      setMatches(result.type === 'candidates' ? result.matches : []);
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
          placeholder="e.g. Grilled chicken, or صدر فراخ"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          dir="auto"
        />
      </FieldLabel>
      <SecondaryButton type="button" disabled={!term.trim()} onClick={handleSearch} className="self-start">
        Search
      </SecondaryButton>

      {error && <p className="text-body text-warn">{error}</p>}

      {matches && matches.length > 0 && (
        <ul className="flex flex-col gap-2">
          {matches.map((match) => (
            <li key={`${match.sourceType}-${match.sourceRef}`}>
              <button
                type="button"
                onClick={() => onMatchSelected(match)}
                className="w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-left text-body hover:bg-accent-soft"
                dir="auto"
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
              dir="auto"
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
