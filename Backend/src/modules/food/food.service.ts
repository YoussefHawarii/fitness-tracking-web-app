import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenFoodFactsClient } from './clients/open-food-facts.client';
import { UsdaClient } from './clients/usda.client';
import { calculateNutrientsForGrams } from './calorie-calculator';
import { CreateLocalFoodItemDto } from './dto/create-local-food-item.dto';
import { CreateFoodLogDto } from './dto/create-food-log.dto';
import { UpdateFoodLogDto } from './dto/update-food-log.dto';

@Injectable()
export class FoodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openFoodFacts: OpenFoodFactsClient,
    private readonly usda: UsdaClient,
  ) {}

  async lookupBarcode(barcode: string) {
    const product = await this.openFoodFacts.lookupByBarcode(barcode);
    if (!product) {
      // Not found (per OFF's own body status, not just HTTP 200) — the
      // caller falls through to manual entry rather than logging a zero result.
      throw new NotFoundException('No product found for this barcode.');
    }
    return product;
  }

  async searchUsda(term: string) {
    return this.usda.searchByTerm(term);
  }

  async createLocalFoodItem(userId: string, dto: CreateLocalFoodItemDto) {
    return this.prisma.localFoodItem.create({
      data: { userId, ...dto },
    });
  }

  async listLocalFoodItems(userId: string) {
    return this.prisma.localFoodItem.findMany({ where: { userId } });
  }

  private async resolveNutrients(
    userId: string,
    sourceType: CreateFoodLogDto['sourceType'],
    sourceRef: string,
  ) {
    if (sourceType === 'OPEN_FOOD_FACTS') {
      const product = await this.openFoodFacts.lookupByBarcode(sourceRef);
      if (!product)
        throw new NotFoundException('Product not found for barcode.');
      return {
        nutrients: product,
        name: product.name,
        localFoodItemId: null as string | null,
      };
    }
    if (sourceType === 'USDA') {
      const matches = await this.usda.searchByTerm(sourceRef);
      const match = matches.find((m) => m.fdcId === sourceRef);
      if (!match) throw new NotFoundException('USDA food item not found.');
      return {
        nutrients: match,
        name: match.name,
        localFoodItemId: null as string | null,
      };
    }
    // LOCAL — private to this user (FR-016)
    const localItem = await this.prisma.localFoodItem.findFirst({
      where: { id: sourceRef, userId },
    });
    if (!localItem) throw new NotFoundException('Local food item not found.');
    return {
      nutrients: {
        caloriesPer100g: Number(localItem.caloriesPer100g),
        proteinPer100g: localItem.proteinPer100g
          ? Number(localItem.proteinPer100g)
          : null,
        carbsPer100g: localItem.carbsPer100g
          ? Number(localItem.carbsPer100g)
          : null,
        fatPer100g: localItem.fatPer100g ? Number(localItem.fatPer100g) : null,
      },
      name: localItem.name,
      localFoodItemId: localItem.id,
    };
  }

  async createFoodLog(userId: string, dto: CreateFoodLogDto) {
    const { nutrients, name, localFoodItemId } = await this.resolveNutrients(
      userId,
      dto.sourceType,
      dto.sourceRef,
    );
    const computed = calculateNutrientsForGrams(nutrients, dto.grams);

    return this.prisma.foodLogEntry.create({
      data: {
        userId,
        sourceType: dto.sourceType,
        sourceRef: dto.sourceRef,
        name,
        localFoodItemId,
        grams: dto.grams,
        caloriesComputed: computed.calories,
        proteinComputed: computed.protein,
        carbsComputed: computed.carbs,
        fatComputed: computed.fat,
        mealCategory: dto.mealCategory,
        loggedAtUtc: new Date(dto.loggedAtUtc),
      },
    });
  }

  async listFoodLogsForDay(userId: string, dayStartUtc: Date, dayEndUtc: Date) {
    return this.prisma.foodLogEntry.findMany({
      where: {
        userId,
        loggedAtUtc: { gte: dayStartUtc, lt: dayEndUtc },
      },
      orderBy: { loggedAtUtc: 'asc' },
    });
  }

  async updateFoodLog(userId: string, id: string, dto: UpdateFoodLogDto) {
    const existing = await this.prisma.foodLogEntry.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Food log entry not found.');
    }

    const grams = dto.grams ?? Number(existing.grams);
    const mealCategory = dto.mealCategory ?? existing.mealCategory;

    // Re-resolve nutrients (rather than trusting the stored computed
    // values) so a since-edited LOCAL food item's per-100g values are
    // reflected, matching how createFoodLog always resolves fresh.
    const { nutrients } = await this.resolveNutrients(
      userId,
      existing.sourceType,
      existing.sourceRef,
    );
    const computed = calculateNutrientsForGrams(nutrients, grams);

    return this.prisma.foodLogEntry.update({
      where: { id },
      data: {
        grams,
        mealCategory,
        caloriesComputed: computed.calories,
        proteinComputed: computed.protein,
        carbsComputed: computed.carbs,
        fatComputed: computed.fat,
      },
    });
  }

  async deleteFoodLog(userId: string, id: string) {
    const existing = await this.prisma.foodLogEntry.findFirst({
      where: { id, userId },
    });
    if (!existing) {
      throw new NotFoundException('Food log entry not found.');
    }
    await this.prisma.foodLogEntry.delete({ where: { id } });
  }
}
