import type { ConfigService } from '@nestjs/config';
import { UsdaClient } from '../../src/modules/food/clients/usda.client';

// A USDA FoodData Central record with no "Energy" nutrient entry at all
// (uncommon but real — some incomplete/experimental FDC records) must not
// silently resolve to 0 kcal/100g — see
// docs/food-log-input-modes-diagnosis.md §3.3.
describe('UsdaClient', () => {
  const originalFetch = global.fetch;
  const configService = {
    get: () => 'fake-api-key',
  } as unknown as ConfigService;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch(body: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    });
  }

  describe('searchByTerm', () => {
    it('excludes a result with no Energy nutrient entry', async () => {
      mockFetch({
        foods: [
          {
            fdcId: 1,
            description: 'Complete food',
            foodNutrients: [{ nutrientName: 'Energy', value: 200 }],
          },
          {
            fdcId: 2,
            description: 'Incomplete food',
            foodNutrients: [{ nutrientName: 'Protein', value: 5 }],
          },
        ],
      });
      const client = new UsdaClient(configService);

      const results = await client.searchByTerm('food');

      expect(results.map((r) => r.fdcId)).toEqual(['1']);
      expect(results[0].caloriesPer100g).toBe(200);
    });
  });

  describe('getById', () => {
    it('returns null when the record has no Energy nutrient entry', async () => {
      mockFetch({
        fdcId: 2,
        description: 'Incomplete food',
        foodNutrients: [{ nutrient: { name: 'Protein' }, amount: 5 }],
      });
      const client = new UsdaClient(configService);

      await expect(client.getById('2')).resolves.toBeNull();
    });

    it('returns the match when Energy is present', async () => {
      mockFetch({
        fdcId: 1,
        description: 'Complete food',
        foodNutrients: [{ nutrient: { name: 'Energy' }, amount: 200 }],
      });
      const client = new UsdaClient(configService);

      await expect(client.getById('1')).resolves.toMatchObject({
        fdcId: '1',
        caloriesPer100g: 200,
      });
    });
  });
});
