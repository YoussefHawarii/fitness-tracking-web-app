import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenFoodFactsClient } from './clients/open-food-facts.client';
import { UsdaClient } from './clients/usda.client';
import { BarcodeLookupCacheService } from './barcode-lookup-cache.service';
import { calculateNutrientsForGrams } from './calorie-calculator';
import { CreateLocalFoodItemDto } from './dto/create-local-food-item.dto';
import { CreateFoodLogDto } from './dto/create-food-log.dto';
import { UpdateFoodLogDto } from './dto/update-food-log.dto';
import { ProductResolverService } from './product-resolver.service';
import { PackagedProductService } from './packaged-product.service';
import { serializePackagedProduct } from './product-mapper';

@Injectable()
export class FoodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openFoodFacts: OpenFoodFactsClient,
    private readonly usda: UsdaClient,
    private readonly barcodeCache: BarcodeLookupCacheService,
    private readonly productResolver: ProductResolverService,
    private readonly packagedProducts: PackagedProductService,
  ) {}

  // Cache-through wrapper — kept for the legacy OPEN_FOOD_FACTS resolution
  // path only (resolveNutrients below, for FoodLogEntry rows created before
  // the local-first PackagedProduct cache existed). New scans no longer go
  // through this method — see lookupBarcode, which now resolves via
  // ProductResolverService (local DB first, Open Food Facts persisted on a
  // hit) instead of calling Open Food Facts on every scan.
  private async getOpenFoodFactsProduct(barcode: string) {
    const cached = this.barcodeCache.get(barcode);
    if (cached) return cached;
    const product = await this.openFoodFacts.lookupByBarcode(barcode);
    if (product) this.barcodeCache.set(barcode, product);
    return product;
  }

  async lookupBarcode(barcode: string) {
    const result = await this.productResolver.resolveBarcode(barcode);
    if (result.status === 'not_found') {
      // Confirmed miss (local DB and every configured provider) — the
      // caller falls through to manual entry / Add Product rather than
      // logging a zero result.
      throw new NotFoundException('No product found for this barcode.');
    }
    if (result.status === 'unavailable') {
      // A provider errored and nothing else resolved it — distinct from a
      // genuine "not found" so the frontend can offer "try again" instead of
      // silently claiming the product doesn't exist.
      throw new ServiceUnavailableException(
        'Barcode lookup is temporarily unavailable.',
      );
    }
    return serializePackagedProduct(result.product, result.resolution);
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
        packagedProductId: null as string | null,
        canonicalNames: null as string[] | null,
      };
    }
    if (sourceType === 'PACKAGED_PRODUCT') {
      const product = await this.packagedProducts.findById(sourceRef);
      if (!product) throw new NotFoundException('Packaged product not found.');
      return {
        nutrients: {
          caloriesPer100g: Number(product.caloriesPer100g),
          proteinPer100g: product.proteinPer100g
            ? Number(product.proteinPer100g)
            : null,
          carbsPer100g: product.carbsPer100g
            ? Number(product.carbsPer100g)
            : null,
          fatPer100g: product.fatPer100g ? Number(product.fatPer100g) : null,
        },
        name: product.name,
        localFoodItemId: null as string | null,
        canonicalFoodId: null as string | null,
        packagedProductId: product.id as string | null,
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
        packagedProductId: null as string | null,
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
        packagedProductId: null as string | null,
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
      packagedProductId: null as string | null,
      canonicalNames: null as string[] | null,
    };
  }

  async createFoodLog(userId: string, dto: CreateFoodLogDto) {
    const {
      nutrients,
      name,
      localFoodItemId,
      canonicalFoodId,
      packagedProductId,
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
        packagedProductId,
        grams: dto.grams,
        // Expand-step dual-write (specs/009-barcode-portion-logging ticket
        // 01): every create records the explicit amount alongside grams.
        amount: dto.grams,
        amountUnit: 'G',
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

    // Prefer the explicit amount, falling back to grams for rows written
    // before ticket 01's dual-write (specs/009-barcode-portion-logging).
    const grams = dto.grams ?? Number(existing.amount ?? existing.grams);
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
        // Expand-step dual-write (specs/009-barcode-portion-logging ticket
        // 01): the update path keeps amount and grams equal.
        amount: grams,
        amountUnit: 'G',
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
