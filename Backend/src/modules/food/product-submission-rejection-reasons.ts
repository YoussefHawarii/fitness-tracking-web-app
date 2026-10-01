export const PRODUCT_SUBMISSION_REJECTION_REASONS = {
  DECLARED_NUTRITION_BASIS_REQUIRED: 'DECLARED_NUTRITION_BASIS_REQUIRED',
  DIMENSION_BASIS_CONFLICT: 'DIMENSION_BASIS_CONFLICT',
} as const;

export type ProductSubmissionRejectionReason =
  (typeof PRODUCT_SUBMISSION_REJECTION_REASONS)[keyof typeof PRODUCT_SUBMISSION_REJECTION_REASONS];

export const PRODUCT_SUBMISSION_REJECTION_MESSAGES: Record<
  ProductSubmissionRejectionReason,
  string
> = {
  DECLARED_NUTRITION_BASIS_REQUIRED: 'declaredNutritionBasis is required.',
  DIMENSION_BASIS_CONFLICT:
    "The product's portion dimension conflicts with its nutrition basis.",
};

export function isProductSubmissionRejectionReason(
  value: string,
): value is ProductSubmissionRejectionReason {
  return Object.values(PRODUCT_SUBMISSION_REJECTION_REASONS).some(
    (reason) => reason === value,
  );
}
