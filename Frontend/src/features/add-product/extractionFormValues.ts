import type {
  ExtractedNutritionCandidate,
  NutritionBasis,
  NutritionLabelExtractionResult,
} from '../../services/foodService';

type NutritionExtractionFormValues = Partial<
  Record<keyof ExtractedNutritionCandidate, string>
> & {
  declaredNutritionBasis?: NutritionBasis;
};

type NutritionBasisResolver = (
  currentBasis: NutritionBasis | '',
  basisSelectedByUser: boolean,
) => NutritionBasis | '';

interface NutritionLabelExtractionHandlers {
  applyValues: (values: NutritionExtractionFormValues) => void;
  updateBasis: (resolveBasis: NutritionBasisResolver) => void;
  setUnavailableReason: (reason: string) => void;
}

export function nutritionCandidateToFormValues(
  candidate: ExtractedNutritionCandidate,
): Partial<Record<keyof ExtractedNutritionCandidate, string>> {
  return Object.fromEntries(
    Object.entries(candidate)
      .filter(([, value]) => value !== undefined)
      .map(([field, value]) => [field, String(value)]),
  );
}

export function nutritionExtractionToFormValues(
  result: NutritionLabelExtractionResult,
): NutritionExtractionFormValues {
  const values =
    result.available && result.candidate
      ? nutritionCandidateToFormValues(result.candidate)
      : {};

  const declaredNutritionBasis = nutritionBasisAfterExtraction(
    result,
    '',
    false,
  );
  if (declaredNutritionBasis) {
    return {
      ...values,
      declaredNutritionBasis,
    };
  }

  return values;
}

export function nutritionBasisAfterExtraction(
  result: NutritionLabelExtractionResult,
  currentBasis: NutritionBasis | '',
  basisSelectedByUser: boolean,
): NutritionBasis | '' {
  if (basisSelectedByUser) return currentBasis;
  if (result.available && result.basisSuggestion?.confident) {
    return result.basisSuggestion.basis;
  }
  return '';
}

export async function completeNutritionLabelExtraction(
  extraction: Promise<NutritionLabelExtractionResult>,
  handlers: NutritionLabelExtractionHandlers,
): Promise<void> {
  const result = await extraction;
  if (!result.available) {
    if (result.reason) handlers.setUnavailableReason(result.reason);
    return;
  }

  handlers.applyValues(nutritionExtractionToFormValues(result));
  handlers.updateBasis((currentBasis, basisSelectedByUser) =>
    nutritionBasisAfterExtraction(result, currentBasis, basisSelectedByUser),
  );
}
