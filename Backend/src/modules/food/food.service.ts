import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenFoodFactsClient } from './clients/open-food-facts.client';
import { UsdaClient } from './clients/usda.client';
import { BarcodeLookupCacheService } from './barcode-lookup-cache.service';
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
    private readonly barcodeCache: BarcodeLookupCacheService,
  ) {}

  // Cache-through wrapper — the scan-time lookup (this method, via the
  // controller) and the save/edit-time resolve (resolveNutrients below) both
  // go through here, so a barcode already resolved during scanning isn't
  // re-fetched from Open Food Facts again a few seconds later at Save. See
  // docs/food-log-input-modes-diagnosis.md §1.2/§1.6 item 4.
  private async getOpenFoodFactsProduct(barcode: string) {
    const cached = this.barcodeCache.get(barcode);
    if (cached) return cached;
    const product = await this.openFoodFacts.lookupByBarcode(barcode);
    if (product) this.barcodeCache.set(barcode, product);
    return product;
  }

  async lookupBarcode(barcode: string) {
    const product = await this.getOpenFoodFactsProduct(barcode);
    if (!product) {
      // Not found (per OFF's own body status, not just HTTP 200) — the
      // caller falls through to manual entry rather than logging a zero result.
      throw new NotFoundException('No product found for this barcode.');
    }
    return product;
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
      const product = await this.getOpenFoodFactsProduct(sourceRef);
      if (!product)
        throw new NotFoundException('Product not found for barcode.');
      return {
        nutrients: product,
        name: product.name,
        localFoodItemId: null as string | null,
        canonicalFoodId: null as string | null,
        canonicalNames: null as string[] | null,
      };
    }
    if (sourceType === 'USDA') {
      const match = await this.usda.getById(sourceRef);
      if (!match) throw new NotFoundException('USDA food item not found.');
      return {
        nutrients: match,
        name: match.name,
        localFoodItemId: null as string | null,
        canonicalFoodId: null as string | null,
        canonicalNames: null as string[] | null,
      };
    }
    if (sourceType === 'CANONICAL') {
      const canonicalFood = await this.prisma.canonicalFood.findUnique({
        where: { id: sourceRef },
      });
      if (!canonicalFood)
        throw new NotFoundException('Canonical food item not found.');
      return {
        nutrients: {
          caloriesPer100g: Number(canonicalFood.caloriesPer100g),
          proteinPer100g: canonicalFood.proteinPer100g
            ? Number(canonicalFood.proteinPer100g)
            : null,
          carbsPer100g: canonicalFood.carbsPer100g
            ? Number(canonicalFood.carbsPer100g)
            : null,
          fatPer100g: canonicalFood.fatPer100g
            ? Number(canonicalFood.fatPer100g)
            : null,
        },
        name: canonicalFood.nameEn,
        localFoodItemId: null as string | null,
        canonicalFoodId: canonicalFood.id,
        canonicalNames: [canonicalFood.nameEn, canonicalFood.nameAr] as
          string[] | null,
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
      canonicalFoodId: null as string | null,
      canonicalNames: null as string[] | null,
    };
  }

  async createFoodLog(userId: string, dto: CreateFoodLogDto) {
    const {
      nutrients,
      name,
      localFoodItemId,
      canonicalFoodId,
      canonicalNames,
    } = await this.resolveNutrients(userId, dto.sourceType, dto.sourceRef);
    const computed = calculateNutrientsForGrams(nutrients, dto.grams);

    // For CANONICAL, trust the client-supplied display name (English or
    // Arabic, whichever the user's search matched) only if it actually
    // matches the record we just resolved — otherwise a client could pair a
    // valid canonical sourceRef with an arbitrary name, decoupling what's
    // displayed from the nutrients actually logged.
    const resolvedName =
      dto.sourceType === 'CANONICAL' &&
      dto.name &&
      canonicalNames?.includes(dto.name)
        ? dto.name
        : name;

    return this.prisma.foodLogEntry.create({
      data: {
        userId,
        sourceType: dto.sourceType,
        sourceRef: dto.sourceRef,
        name: resolvedName,
        localFoodItemId,
        canonicalFoodId,
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
