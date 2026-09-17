import { Injectable } from '@nestjs/common';

export interface ExtractedNutritionCandidate {
  caloriesPer100g?: number;
  proteinPer100g?: number;
  carbsPer100g?: number;
  fatPer100g?: number;
  fiberPer100g?: number;
  sugarPer100g?: number;
  sodiumPer100g?: number;
  servingSize?: number;
  servingUnit?: string;
}

export interface NutritionLabelExtractionResult {
  available: boolean;
  reason?: string;
  // Present only when available is true. Always a starting point for the
  // user to review/correct, never auto-saved — the frontend must show these
  // in the same editable Add Product form used for manual entry.
  candidate?: ExtractedNutritionCandidate;
}

// Isolates nutrition-label OCR/vision behind a narrow interface so a real
// provider can be plugged in later without touching the controller, DTO, or
// frontend contract — only this class's `extract` method would change.
//
// No OCR/vision provider is configured in this deployment: this app
// previously and deliberately rejected paid photo-based food recognition to
// avoid image-API costs and ML/CV scope (docs/requirements-spec.md,
// specs/001-calorie-weight-tracking/spec.md), and nutrition-label OCR carries
// the same cost tradeoff. Wiring a real provider here later would need, at
// minimum: an API key/credentials in Backend/.env.example, a per-request cost
// or rate-limit budget, and a mapping from that provider's output fields to
// ExtractedNutritionCandidate above.
//
// This stub always reports itself unavailable — callers must degrade to
// manual entry, never treat "unavailable" as an error.
@Injectable()
export class NutritionLabelExtractionService {
  // Signature kept as the real contract a future OCR/vision provider would
  // implement, even though this stub ignores both arguments (referenced via
  // `void` below so they count as used without a fragile disable-comment
  // that reformatting could detach from the right line).
  extract(
    image: Buffer,
    mimeType: string,
  ): Promise<NutritionLabelExtractionResult> {
    void image;
    void mimeType;
    return Promise.resolve({
      available: false,
      reason:
        'Automatic nutrition label scanning is not set up for this deployment yet — enter the values manually below.',
    });
  }
}
