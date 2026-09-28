import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  BaseUnit,
  ContainerKey,
  NutritionBasis,
  Prisma,
  ProductSource,
  VerificationStatus,
} from '@prisma/client';
import type { PackagedProduct } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeBarcode } from './barcode-normalizer';
import type {
  CataloguableProductLookup,
  PortionMetadataLookup,
} from './providers/product-provider.interface';
import { CreatePackagedProductDto } from './dto/create-packaged-product.dto';
import { legacyUnitForBaseUnit, normalizeMeasurement } from './unit-normalizer';
import {
  PRODUCT_SUBMISSION_REJECTION_MESSAGES,
  PRODUCT_SUBMISSION_REJECTION_REASONS,
  type ProductSubmissionRejectionReason,
} from './product-submission-rejection-reasons';

export function isUniqueBarcodeViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    (err.meta?.target as string[] | undefined)?.includes('barcode') === true
  );
}

function productSubmissionError(reason: ProductSubmissionRejectionReason) {
  return new BadRequestException({
    message: PRODUCT_SUBMISSION_REJECTION_MESSAGES[reason],
    reason,
  });
}

// The local product catalog: reads/writes on PackagedProduct itself, with no
// knowledge of providers or of the resolution order — that's
// ProductResolverService's job. Kept separate so "where products are stored"
// and "how a barcode gets resolved" can be reasoned about independently, per
// this module's existing local-item/canonical-item split.
@Injectable()
export class PackagedProductService {
  private readonly logger = new Logger(PackagedProductService.name);

  constructor(private readonly prisma: PrismaService) {}

  findByBarcode(barcode: string): Promise<PackagedProduct | null> {
    return this.prisma.packagedProduct.findUnique({ where: { barcode } });
  }

  findById(id: string): Promise<PackagedProduct | null> {
    return this.prisma.packagedProduct.findUnique({ where: { id } });
  }

  async fillPortionGaps(
    product: PackagedProduct,
    data: PortionMetadataLookup,
    checkedAt: Date,
  ): Promise<PackagedProduct> {
    if (
      product.source !== ProductSource.OPEN_FOOD_FACTS ||
      product.verificationStatus === VerificationStatus.VERIFIED
    ) {
      return product;
    }

    const eligibleWhere: Prisma.PackagedProductWhereInput = {
      id: product.id,
      source: ProductSource.OPEN_FOOD_FACTS,
      verificationStatus: { not: VerificationStatus.VERIFIED },
    };
    const existingPackage = normalizeMeasurement(
      product.packageSize,
      legacyUnitForBaseUnit(product.packageBaseUnit),
    );
    const providerPackage = normalizeMeasurement(
      data.packageSize,
      legacyUnitForBaseUnit(data.packageBaseUnit),
    );
    if (!existingPackage && providerPackage) {
      await this.prisma.packagedProduct.updateMany({
        where: {
          ...eligibleWhere,
          OR: [
            { packageSize: null },
            { packageSize: { lte: 0 } },
            { packageBaseUnit: null },
          ],
        },
        data: {
          packageSize: providerPackage.value,
          packageUnit: providerPackage.legacyUnit,
          packageBaseUnit: providerPackage.baseUnit,
        },
      });
    }

    const existingServing = normalizeMeasurement(
      product.servingSize,
      legacyUnitForBaseUnit(product.servingBaseUnit),
    );
    const providerServing = normalizeMeasurement(
      data.servingSize,
      legacyUnitForBaseUnit(data.servingBaseUnit),
    );
    if (!existingServing && providerServing) {
      await this.prisma.packagedProduct.updateMany({
        where: {
          ...eligibleWhere,
          OR: [
            { servingSize: null },
            { servingSize: { lte: 0 } },
            { servingBaseUnit: null },
          ],
        },
        data: {
          servingSize: providerServing.value,
          servingUnit: providerServing.legacyUnit,
          servingBaseUnit: providerServing.baseUnit,
        },
      });
    }

    if (
      (!product.containerKey ||
        product.containerKey === ContainerKey.PACKAGE) &&
      data.containerKey &&
      data.containerKey !== ContainerKey.PACKAGE
    ) {
      await this.prisma.packagedProduct.updateMany({
        where: {
          ...eligibleWhere,
          OR: [{ containerKey: null }, { containerKey: ContainerKey.PACKAGE }],
        },
        data: { containerKey: data.containerKey },
      });
    }

    await this.prisma.packagedProduct.updateMany({
      where: eligibleWhere,
      data: { lastProviderCheckAt: checkedAt },
    });

    return this.prisma.packagedProduct.findUniqueOrThrow({
      where: { id: product.id },
    });
  }

  // Called only on a genuine local-DB miss, right after a provider found the
  // barcode. Optimistic create + fall back to the existing row on a unique
  // violation, so two concurrent first-time scans of the same new barcode
  // can't create duplicate rows (the race is inherent to "check local DB,
  // then write" without a table-level lock, so it's handled here instead of
  // prevented upstream).
  async upsertFromProvider(
    barcode: string,
    data: CataloguableProductLookup,
    source: ProductSource,
  ): Promise<PackagedProduct> {
    try {
      const created = await this.createFromProvider(
        barcode,
        data,
        source,
        this.prisma,
      );
      this.logger.log(`product cached: ${barcode} (source=${source})`);
      return created;
    } catch (err) {
      if (isUniqueBarcodeViolation(err)) {
        // Lost the race to another request resolving the same new barcode at
        // the same time — both fetched identical data from the same
        // provider, so there's nothing to merge; just return the winner.
        return this.prisma.packagedProduct.findUniqueOrThrow({
          where: { barcode },
        });
      }
      throw err;
    }
  }

  async createFromProvider(
    barcode: string,
    data: CataloguableProductLookup,
    source: ProductSource,
    db: Pick<Prisma.TransactionClient, 'packagedProduct'>,
  ): Promise<PackagedProduct> {
    if (!Number.isFinite(data.caloriesPer100g) || data.caloriesPer100g <= 0) {
      throw new Error('Provider product does not have usable calories.');
    }
    const serving = normalizeMeasurement(
      data.servingSize,
      legacyUnitForBaseUnit(data.servingBaseUnit),
    );
    const packageMeasurement = normalizeMeasurement(
      data.packageSize,
      legacyUnitForBaseUnit(data.packageBaseUnit),
    );
    return db.packagedProduct.create({
      data: {
        barcode,
        name: data.name,
        nameAr: data.nameAr,
        brand: data.brand,
        category: data.category,
        servingSize: serving?.value ?? null,
        servingUnit: serving?.legacyUnit ?? null,
        servingBaseUnit: serving?.baseUnit ?? null,
        packageSize: packageMeasurement?.value ?? null,
        packageUnit: packageMeasurement?.legacyUnit ?? null,
        packageBaseUnit: packageMeasurement?.baseUnit ?? null,
        containerKey: data.containerKey ?? ContainerKey.PACKAGE,
        caloriesPer100g: data.caloriesPer100g,
        proteinPer100g: data.proteinPer100g,
        carbsPer100g: data.carbsPer100g,
        fatPer100g: data.fatPer100g,
        fiberPer100g: data.fiberPer100g,
        sugarPer100g: data.sugarPer100g,
        sodiumPer100g: data.sodiumPer100g,
        imageUrl: data.imageUrl,
        country: data.country,
        source,
        sourceId: data.sourceId ?? barcode,
        verificationStatus: VerificationStatus.EXTERNAL,
        lastProviderCheckAt:
          source === ProductSource.OPEN_FOOD_FACTS ? new Date() : null,
      },
    });
  }

  async createUserSubmitted(
    dto: CreatePackagedProductDto,
  ): Promise<PackagedProduct> {
    const normalized = normalizeBarcode(dto.barcode);
    if (!normalized) {
      // Malformed input, not a naming collision — 400, not 409 (which is
      // reserved for a well-formed barcode that already has a product).
      throw new BadRequestException(
        'Not a valid EAN-13/EAN-8/UPC-A/UPC-E barcode.',
      );
    }
    const barcode = normalized.canonical;
    // The older deployed form explicitly labels every nutrition field per
    // 100 g, so omitting this newer field is still a user declaration of a
    // mass basis. Explicit values from the current form remain authoritative.
    const declaredNutritionBasis =
      dto.declaredNutritionBasis ?? NutritionBasis.PER_100_G;
    const serving = normalizeMeasurement(dto.servingSize, dto.servingUnit);
    const packageMeasurement = normalizeMeasurement(
      dto.packageSize,
      dto.packageUnit,
    );
    const portionBaseUnit =
      packageMeasurement?.baseUnit ?? serving?.baseUnit ?? null;
    const basisBaseUnit =
      declaredNutritionBasis === NutritionBasis.PER_100_G
        ? BaseUnit.G
        : BaseUnit.ML;

    if (portionBaseUnit && portionBaseUnit !== basisBaseUnit) {
      throw productSubmissionError(
        PRODUCT_SUBMISSION_REJECTION_REASONS.DIMENSION_BASIS_CONFLICT,
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const product = await tx.packagedProduct.create({
          data: {
            barcode,
            name: dto.name,
            nameAr: dto.nameAr ?? null,
            brand: dto.brand ?? null,
            category: dto.category ?? null,
            servingSize: serving?.value ?? null,
            servingUnit: serving?.legacyUnit ?? null,
            servingBaseUnit: serving?.baseUnit ?? null,
            packageSize: packageMeasurement?.value ?? null,
            packageUnit: packageMeasurement?.legacyUnit ?? null,
            packageBaseUnit: packageMeasurement?.baseUnit ?? null,
            declaredNutritionBasis,
            caloriesPer100g: dto.caloriesPer100g,
            proteinPer100g: dto.proteinPer100g,
            carbsPer100g: dto.carbsPer100g,
            fatPer100g: dto.fatPer100g,
            fiberPer100g: dto.fiberPer100g ?? null,
            sugarPer100g: dto.sugarPer100g ?? null,
            sodiumPer100g: dto.sodiumPer100g ?? null,
            country: dto.country ?? null,
            source: ProductSource.USER_SUBMITTED,
            sourceId: null,
            verificationStatus: VerificationStatus.UNVERIFIED,
          },
        });
        await tx.identifiedBarcode.deleteMany({ where: { barcode } });
        return product;
      });
      this.logger.log(`user-submitted product created: ${barcode}`);
      return created;
    } catch (err) {
      if (isUniqueBarcodeViolation(err)) {
        throw new ConflictException(
          'A product with this barcode already exists.',
        );
      }
      throw err;
    }
  }
}
