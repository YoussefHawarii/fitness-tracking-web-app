export const PRODUCT_SUBMISSION_REJECTION_REASONS = {
  DIMENSION_BASIS_CONFLICT: 'DIMENSION_BASIS_CONFLICT',
} as const;

export type ProductSubmissionRejectionReason =
  (typeof PRODUCT_SUBMISSION_REJECTION_REASONS)[keyof typeof PRODUCT_SUBMISSION_REJECTION_REASONS];

export const PRODUCT_SUBMISSION_REJECTION_MESSAGES: Record<
  ProductSubmissionRejectionReason,
  string
> = {
  DIMENSION_BASIS_CONFLICT:
    "The product's portion dimension conflicts with its nutrition basis.",
};
