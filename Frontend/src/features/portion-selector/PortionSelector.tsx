import type { Ref } from 'react';
import { FieldLabel, Input } from '../../components/ui/Input';
import type { BaseUnit } from '../../services/foodService';
import type { PortionOption, PortionOptionId } from './portionOptions';

export function PortionSelector({
  options,
  selectedOptionId,
  customAmount,
  baseUnit,
  onSelectionChange,
  onCustomAmountChange,
  customInputRef,
}: {
  options: PortionOption[];
  selectedOptionId: PortionOptionId | null;
  customAmount: string;
  baseUnit: BaseUnit;
  onSelectionChange: (optionId: PortionOptionId) => void;
  onCustomAmountChange: (amount: string) => void;
  customInputRef?: Ref<HTMLInputElement>;
}) {
  const customSelected = selectedOptionId === 'CUSTOM';
  const unitLabel = baseUnit === 'ML' ? 'ml' : 'g';

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-body font-semibold text-text">
        Choose a portion
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const selected = option.id === selectedOptionId;
          return (
            <label
              key={option.id}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-body transition ${
                selected
                  ? 'border-accent bg-accent-soft text-text'
                  : 'border-border bg-surface-raised text-text hover:border-accent'
              }`}
            >
              <input
                type="radio"
                name="portion-option"
                value={option.id}
                checked={selected}
                onChange={() => onSelectionChange(option.id)}
                className="accent-accent"
              />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
      {customSelected ? (
        <FieldLabel>
          Amount ({unitLabel})
          <Input
            ref={customInputRef}
            type="number"
            min={0.1}
            step={0.1}
            value={customAmount}
            onChange={(event) => onCustomAmountChange(event.target.value)}
          />
        </FieldLabel>
      ) : null}
    </fieldset>
  );
}
