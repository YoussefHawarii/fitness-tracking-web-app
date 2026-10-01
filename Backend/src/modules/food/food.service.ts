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
import {
  serializeIdentifiedBarcode,
  serializePackagedProduct,
} from './product-mapper';
import { resolvePackagedProductPortion } from './portion-resolution';
import {
  FOOD_LOG_REJECTION_MESSAGES,
  FOOD_LOG_REJECTION_REASONS,
  type FoodLogRejectionReason,
} from './food-log-rejection-reasons';
import type { FoodLogEntry, PackagedProduct } from '@prisma/client';

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

  private calculateSafePackagedProductNutrients(
    product: PackagedProduct,
    amount: number,
    amountUnit: CreateFoodLogDto['amountUnit'],
    portionKind?: CreateFoodLogDto['portionKind'],
    portionMultiplier?: number,
  ) {
    const { resolution } = resolvePackagedProductPortion(product);
    if (resolution.outcome === 'NOT_LOGGABLE') {
      this.reject(resolution.primaryReason);
    }

    const expectedUnit =
      resolution.effectiveNutritionBasis.basis === 'PER_100_G' ? 'G' : 'ML';
    if (amountUnit !== expectedUnit) {
      this.reject(FOOD_LOG_REJECTION_REASONS.AMOUNT_UNIT_BASIS_MISMATCH);
    }

    if (portionKind === 'PACKAGE' || portionKind === 'SERVING') {
      const measurement =
        portionKind === 'PACKAGE' ? resolution.package : resolution.serving;
      if (!measurement) {
        this.reject(
          portionKind === 'PACKAGE'
            ? FOOD_LOG_REJECTION_REASONS.PACKAGE_PORTION_UNAVAILABLE
            : FOOD_LOG_REJECTION_REASONS.SERVING_PORTION_UNAVAILABLE,
        );
      }
      const expectedAmount = measurement.size * (portionMultiplier ?? 0);
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

    return calculateNutrientsForAmount(
      this.nutrientsFromPackagedProduct(product),
      amount,
      amountUnit,
      resolution.effectiveNutritionBasis.basis,
    );
  }

  private rejectStructuredPortionForMassSource(
    portionKind?: CreateFoodLogDto['portionKind'],
  ) {
    if (portionKind !== 'PACKAGE' && portionKind !== 'SERVING') return;
    this.reject(
      portionKind === 'PACKAGE'
        ? FOOD_LOG_REJECTION_REASONS.PACKAGE_PORTION_UNAVAILABLE
        : FOOD_LOG_REJECTION_REASONS.SERVING_PORTION_UNAVAILABLE,
    );
  }

  private isUnchangedFoodLogAmount(
    existing: Pick<
      FoodLogEntry,
      'amount' | 'amountUnit' | 'portionKind' | 'portionMultiplier'
    >,
    dto: UpdateFoodLogDto,
  ): boolean {
    const submittedAmount = dto.amount;
    if (submittedAmount === undefined) return false;

    if (
      submittedAmount !== Number(existing.amount) ||
      dto.amountUnit !== existing.amountUnit
    ) {
      return false;
    }

    const storedMultiplier =
      existing.portionMultiplier === null
        ? null
        : Number(existing.portionMultiplier);
    return (
      (dto.portionKind ?? null) === existing.portionKind &&
      (dto.portionMultiplier ?? null) === storedMultiplier
    );
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
    const result = await this.openFoodFacts.lookupByBarcode(barcode);
    if (result.outcome !== 'FOUND_WITH_NUTRITION') return null;
    this.barcodeCache.set(barcode, result);
    return result;
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
    if (result.status === 'identified') {
      return serializeIdentifiedBarcode(result.identification);
    }
    return serializePackagedProduct(result.product, result.resolution);
  }

  async getPackagedProduct(id: string) {
    const product = await this.packagedProducts.findById(id);
    if (!product) throw new NotFoundException('Packaged product not found.');
    const { resolution } = resolvePackagedProductPortion(product);
    return serializePackagedProduct(product, resolution);
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

    const { amount, amountUnit } = dto;

    if (dto.sourceType !== 'PACKAGED_PRODUCT') {
      this.rejectStructuredPortionForMassSource(dto.portionKind);
    }

    if (dto.sourceType === 'PACKAGED_PRODUCT') {
      const product = await this.packagedProducts.findById(dto.sourceRef);
      if (!product) throw new NotFoundException('Packaged product not found.');

      const computed = this.calculateSafePackagedProductNutrients(
        product,
        amount,
        amountUnit,
        dto.portionKind,
        dto.portionMultiplier,
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

    const hasAmountUpdate = dto.amount !== undefined;

    if (existing.sourceType === 'PACKAGED_PRODUCT') {
      const product = await this.packagedProducts.findById(
        existing.packagedProductId ?? existing.sourceRef,
      );
      if (!product) {
        throw new NotFoundException('Packaged product not found.');
      }
      if (!hasAmountUpdate || this.isUnchangedFoodLogAmount(existing, dto)) {
        if (dto.mealCategory === undefined) return existing;
        return this.prisma.foodLogEntry.update({
          where: { id },
          data: { mealCategory: dto.mealCategory },
        });
      }

      const amount = dto.amount;
      if (amount === undefined) {
        throw new Error('Validated food-log update did not contain an amount.');
      }
      const amountUnit = dto.amountUnit;
      if (!amountUnit) {
        throw new Error('Validated amount did not contain an amount unit.');
      }
      const computed = this.calculateSafePackagedProductNutrients(
        product,
        amount,
        amountUnit,
        dto.amount === undefined ? undefined : dto.portionKind,
        dto.amount === undefined ? undefined : dto.portionMultiplier,
      );
      return this.prisma.foodLogEntry.update({
        where: { id },
        data: {
          amount,
          amountUnit,
          portionKind: dto.portionKind ?? null,
          portionMultiplier: dto.portionMultiplier ?? null,
          mealCategory: dto.mealCategory ?? existing.mealCategory,
          caloriesComputed: computed.calories,
          proteinComputed: computed.protein,
          carbsComputed: computed.carbs,
          fatComputed: computed.fat,
        },
      });
    }

    if (!hasAmountUpdate || this.isUnchangedFoodLogAmount(existing, dto)) {
      if (dto.mealCategory === undefined) return existing;
      return this.prisma.foodLogEntry.update({
        where: { id },
        data: { mealCategory: dto.mealCategory },
      });
    }

    const amount = dto.amount;
    if (amount === undefined) {
      throw new Error('Validated food-log update did not contain an amount.');
    }

    const amountUnit = dto.amountUnit;
    if (amountUnit !== 'G') {
      this.reject(FOOD_LOG_REJECTION_REASONS.MASS_SOURCE_REQUIRES_G);
    }
    this.rejectStructuredPortionForMassSource(dto.portionKind);

    // Historical OPEN_FOOD_FACTS rows retain their live provider
    // re-resolution path; new entries cannot use it.
    const { nutrients } = await this.resolveNutrients(
      userId,
      existing.sourceType,
      existing.sourceRef,
    );
    const computed = calculateNutrientsForGrams(nutrients, amount);
    return this.prisma.foodLogEntry.update({
      where: { id },
      data: {
        amount,
        amountUnit: 'G',
        portionKind: dto.portionKind ?? null,
        portionMultiplier: dto.portionMultiplier ?? null,
        mealCategory: dto.mealCategory ?? existing.mealCategory,
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
