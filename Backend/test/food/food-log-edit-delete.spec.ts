import { NotFoundException } from '@nestjs/common';
import { FoodService } from '../../src/modules/food/food.service';

// Covers specs/007-date-picker-food-log-edit/data-model.md:
// updateFoodLog recomputes nutrients from stored source; both methods
// enforce ownership the same way CalorieBalanceService's exercise-log
// edit/delete do.
describe('FoodService — updateFoodLog / deleteFoodLog', () => {
  const userId = 'user-1';

  function buildService(
    overrides: {
      existing?: Partial<Record<string, unknown>>;
      localItem?: Partial<Record<string, unknown>> | null;
    } = {},
  ) {
    const existing = {
      id: 'log-1',
      userId,
      sourceType: 'LOCAL',
      sourceRef: 'local-1',
      name: "Mom's lasagna",
      localFoodItemId: 'local-1',
      grams: 100,
      mealCategory: 'LUNCH',
      ...overrides.existing,
    };

    const updateCalls: Record<string, unknown>[] = [];
    const prisma = {
      foodLogEntry: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn((args: { data: Record<string, unknown> }) => {
          updateCalls.push(args.data);
          return Promise.resolve({ ...existing, ...args.data });
        }),
        delete: jest.fn().mockResolvedValue(existing),
      },
      localFoodItem: {
        findFirst: jest.fn().mockResolvedValue(
          overrides.localItem === null
            ? null
            : {
                id: 'local-1',
                name: "Mom's lasagna",
                caloriesPer100g: 200,
                proteinPer100g: null,
                carbsPer100g: null,
                fatPer100g: null,
                ...overrides.localItem,
              },
        ),
      },
    };
    const openFoodFacts = { lookupByBarcode: jest.fn() };
    const usda = { searchByTerm: jest.fn() };

    const service = new FoodService(
      prisma as never,
      openFoodFacts as never,
      usda as never,
    );
    return { service, prisma, updateCalls };
  }

  it('recomputes calories proportionally to the new grams', async () => {
    const { service, updateCalls } = buildService({
      existing: { grams: 100 },
    });

    await service.updateFoodLog(userId, 'log-1', { grams: 250 });

    expect(updateCalls[0].grams).toBe(250);
    // 200 cal/100g * 250g = 500
    expect(updateCalls[0].caloriesComputed).toBe(500);
  });

  it('updates mealCategory without requiring grams', async () => {
    const { service, updateCalls } = buildService();

    await service.updateFoodLog(userId, 'log-1', { mealCategory: 'DINNER' });

    expect(updateCalls[0].mealCategory).toBe('DINNER');
    expect(updateCalls[0].grams).toBe(100); // unchanged, from existing entry
  });

  it('throws NotFoundException when updating an entry not owned by the user', async () => {
    const { service, prisma } = buildService();
    prisma.foodLogEntry.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.updateFoodLog(userId, 'log-1', { grams: 50 }),
    ).rejects.toThrow(NotFoundException);
  });

  it('deletes an entry owned by the user', async () => {
    const { service, prisma } = buildService();

    await service.deleteFoodLog(userId, 'log-1');

    expect(prisma.foodLogEntry.delete).toHaveBeenCalledWith({
      where: { id: 'log-1' },
    });
  });

  it('throws NotFoundException when deleting an entry not owned by the user', async () => {
    const { service, prisma } = buildService();
    prisma.foodLogEntry.findFirst.mockResolvedValueOnce(null);

    await expect(service.deleteFoodLog(userId, 'log-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});
