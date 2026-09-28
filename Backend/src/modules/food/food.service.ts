import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OpenFoodFactsClient } from './clients/open-food-facts.client';
import { UsdaClient } from './clients/usda.client';
import { BarcodeLookupCacheService } from './barcode-lookup-cache.service';
import {
  calculateNutrientsForAmount,
  calculateNutrientsForGrams,
  type NutrientsPer100g,
} from './calorie-calculator';
import { CreateLocalFoodItemDto } from './dto/create-local-food-item.dto';
import { CreateFoodLogDto } from './dto/create-food-log.dto';
import { UpdateFoodLogDto } from './dto/update-food-log.dto';
import { ProductResolverService } from './product-resolver.service';
import { PackagedProductService } from './packaged-product.service';
import { serializePackagedProduct } from './product-mapper';
import { resolvePackagedProductPortion } from './portion-resolution';
import {
  FOOD_LOG_REJECTION_MESSAGES,
  FOOD_LOG_REJECTION_REASONS,
  type FoodLogRejectionReason,
} from './food-log-rejection-reasons';

const PORTION_AMOUNT_TOLERANCE = 0.05;

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

  private reject(reason: FoodLogRejectionReason): never {
    throw new UnprocessableEntityException({
      message: FOOD_LOG_REJECTION_MESSAGES[reason],
      reason,
    });
  }

  private nutrientsFromPackagedProduct(product: {
    caloriesPer100g: unknown;
    proteinPer100g: unknown;
    carbsPer100g: unknown;
    fatPer100g: unknown;
  }): NutrientsPer100g {
    return {
      caloriesPer100g: Number(product.caloriesPer100g),
      proteinPer100g:
        product.proteinPer100g === null ? null : Number(product.proteinPer100g),
      carbsPer100g:
        product.carbsPer100g === null ? null : Number(product.carbsPer100g),
      fatPer100g:
        product.fatPer100g === null ? null : Number(product.fatPer100g),
    };
  }

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
        nutrients: this.nutrientsFromPackagedProduct(product),
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
    if (dto.sourceType === 'OPEN_FOOD_FACTS') {
      this.reject(FOOD_LOG_REJECTION_REASONS.OPEN_FOOD_FACTS_CREATE_RETIRED);
    }

    const amount = dto.amount ?? dto.grams;
    if (amount === undefined) {
      throw new Error('Validated food-log DTO did not contain an amount.');
    }
    const amountUnit =
      dto.amount === undefined ? ('G' as const) : dto.amountUnit;
    if (!amountUnit) {
      throw new Error('Validated amount did not contain an amount unit.');
    }

    if (
      dto.sourceType !== 'PACKAGED_PRODUCT' &&
      (dto.portionKind === 'PACKAGE' || dto.portionKind === 'SERVING')
    ) {
      this.reject(
        dto.portionKind === 'PACKAGE'
          ? FOOD_LOG_REJECTION_REASONS.PACKAGE_PORTION_UNAVAILABLE
          : FOOD_LOG_REJECTION_REASONS.SERVING_PORTION_UNAVAILABLE,
      );
    }

    if (dto.sourceType === 'PACKAGED_PRODUCT') {
      const product = await this.packagedProducts.findById(dto.sourceRef);
      if (!product) throw new NotFoundException('Packaged product not found.');

      const { resolution } = resolvePackagedProductPortion(product);
      if (resolution.outcome === 'NOT_LOGGABLE') {
        this.reject(resolution.primaryReason);
      }

      const expectedUnit =
        resolution.effectiveNutritionBasis.basis === 'PER_100_G' ? 'G' : 'ML';
      if (amountUnit !== expectedUnit) {
        this.reject(FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_BASIS_MISMATCH);
      }

      if (dto.portionKind === 'PACKAGE' || dto.portionKind === 'SERVING') {
        const measurement =
          dto.portionKind === 'PACKAGE'
            ? resolution.package
            : resolution.serving;
        if (!measurement) {
          this.reject(
            dto.portionKind === 'PACKAGE'
              ? FOOD_LOG_REJECTION_REASONS.PACKAGE_PORTION_UNAVAILABLE
              : FOOD_LOG_REJECTION_REASONS.SERVING_PORTION_UNAVAILABLE,
          );
        }
        const expectedAmount = measurement.size * (dto.portionMultiplier ?? 0);
        const floatingPointMargin =
          Number.EPSILON *
          Math.max(1, Math.abs(amount), Math.abs(expectedAmount));
        if (
          Math.abs(amount - expectedAmount) >
          PORTION_AMOUNT_TOLERANCE + floatingPointMargin
        ) {
          this.reject(FOOD_LOG_REJECTION_REASONS.PORTION_AMOUNT_MISMATCH);
        }
      }

      const computed = calculateNutrientsForAmount(
        this.nutrientsFromPackagedProduct(product),
        amount,
        amountUnit,
        resolution.effectiveNutritionBasis.basis,
      );

      return this.prisma.foodLogEntry.create({
        data: {
          userId,
          sourceType: dto.sourceType,
          sourceRef: dto.sourceRef,
          name: product.name,
          localFoodItemId: null,
          canonicalFoodId: null,
          packagedProductId: product.id,
          grams: amountUnit === 'G' ? amount : null,
          amount,
          amountUnit,
          portionKind: dto.portionKind ?? null,
          portionMultiplier: dto.portionMultiplier ?? null,
          caloriesComputed: computed.calories,
          proteinComputed: computed.protein,
          carbsComputed: computed.carbs,
          fatComputed: computed.fat,
          mealCategory: dto.mealCategory,
          loggedAtUtc: new Date(dto.loggedAtUtc),
        },
      });
    }

    if (amountUnit !== 'G') {
      this.reject(FOOD_LOG_REJECTION_REASONS.MASS_SOURCE_REQUIRES_G);
    }

    const {
      nutrients,
      name,
      localFoodItemId,
      canonicalFoodId,
      packagedProductId,
      canonicalNames,
    } = await this.resolveNutrients(userId, dto.sourceType, dto.sourceRef);
    const computed = calculateNutrientsForGrams(nutrients, amount);

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
        grams: amount,
        amount,
        amountUnit: 'G',
        portionKind: dto.portionKind ?? null,
        portionMultiplier: dto.portionMultiplier ?? null,
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

    if (existing.amountUnit === 'ML') {
      // Deployment-transition guard: preserve unit semantics until the
      // complete unit-aware edit contract replaces this restricted path.
      if (
        dto.grams !== undefined ||
        dto.amount !== undefined ||
        dto.amountUnit !== undefined
      ) {
        this.reject(FOOD_LOG_REJECTION_REASONS.ML_AMOUNT_EDIT_UNAVAILABLE);
      }
      const product = await this.packagedProducts.findById(
        existing.packagedProductId ?? existing.sourceRef,
      );
      if (!product) {
        throw new NotFoundException('Packaged product not found.');
      }
      return this.prisma.foodLogEntry.update({
        where: { id },
        data: { mealCategory: dto.mealCategory ?? existing.mealCategory },
      });
    }

    if (dto.amount !== undefined || dto.amountUnit !== undefined) {
      this.reject(
        FOOD_LOG_REJECTION_REASONS.UPDATE_AMOUNT_REPRESENTATION_UNSUPPORTED,
      );
    }

    // Prefer the explicit amount, falling back to grams for legacy rows.
    const storedAmount = Number(existing.amount ?? existing.grams);
    const grams = dto.grams ?? storedAmount;
    const mealCategory = dto.mealCategory ?? existing.mealCategory;
    const gramsChanged = dto.grams !== undefined && dto.grams !== storedAmount;

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
        amount: grams,
        amountUnit: 'G',
        ...(gramsChanged
          ? {
              portionKind:
                existing.portionKind === null ? null : ('CUSTOM' as const),
              portionMultiplier: null,
            }
          : {}),
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
