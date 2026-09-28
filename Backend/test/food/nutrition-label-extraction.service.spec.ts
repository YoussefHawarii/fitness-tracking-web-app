import {
  NutritionLabelExtractionService,
  type NutritionLabelExtractionResult,
} from '../../src/modules/food/nutrition-label-extraction.service';

describe('NutritionLabelExtractionService', () => {
  it('represents a basis suggestion with explicit confidence', () => {
    const result: NutritionLabelExtractionResult = {
      available: true,
      basisSuggestion: {
        basis: 'PER_100_ML',
        confident: false,
      },
    };

    expect(result.basisSuggestion).toEqual({
      basis: 'PER_100_ML',
      confident: false,
    });
  });

  it('keeps the unavailable stub response unchanged', async () => {
    const service = new NutritionLabelExtractionService();

    await expect(
      service.extract(Buffer.from('nutrition-label'), 'image/jpeg'),
    ).resolves.toEqual({
      available: false,
      reason:
        'Automatic nutrition label scanning is not set up for this deployment yet — enter the values manually below.',
    });
  });
});
