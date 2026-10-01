import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  BaseUnit,
  ContainerKey,
  NutritionBasis,
  Prisma,
  ProductSource,
  VerificationStatus,
  type PackagedProduct,
} from '@prisma/client';
import { PackagedProductService } from '../../src/modules/food/packaged-product.service';
import type { CataloguableProductLookup } from '../../src/modules/food/providers/product-provider.interface';
import { resolvePackagedProductPortion } from '../../src/modules/food/portion-resolution';

function uniqueBarcodeViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['barcode'] },
  });
}

describe('PackagedProductService', () => {
  const barcode = '3017620422003';
  const checkedAt = new Date('2026-09-28T12:00:00.000Z');
  const providerResult: CataloguableProductLookup = {
    name: 'Nutella',
    caloriesPer100g: 539,
    proteinPer100g: 6.3,
    carbsPer100g: 57.5,
    fatPer100g: 30.9,
    servingSize: 60,
    servingUnit: 'kg',
    servingBaseUnit: BaseUnit.G,
    packageSize: 330,
    packageUnit: 'litres-from-provider-must-not-be-stored',
    packageBaseUnit: BaseUnit.ML,
    containerKey: ContainerKey.JAR,
  };

  function productRow(
    overrides: Partial<PackagedProduct> = {},
  ): PackagedProduct {
    return {
      id: 'product-1',
      barcode,
      name: 'Cached product',
      nameAr: null,
      brand: null,
      category: null,
      servingSize: null,
      servingBaseUnit: null,
      packageSize: null,
      packageBaseUnit: null,
      containerKey: ContainerKey.PACKAGE,
      declaredNutritionBasis: null,
      caloriesPer100g: new Prisma.Decimal(539),
      proteinPer100g: new Prisma.Decimal(6.3),
      carbsPer100g: new Prisma.Decimal(57.5),
      fatPer100g: new Prisma.Decimal(30.9),
      fiberPer100g: null,
      sugarPer100g: null,
      sodiumPer100g: null,
      imageUrl: null,
      country: null,
      source: ProductSource.OPEN_FOOD_FACTS,
      sourceId: barcode,
      verificationStatus: VerificationStatus.EXTERNAL,
      lastProviderCheckAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function buildService() {
    const packagedProduct = {
      create: jest.fn(
        (args: { data: Record<string, unknown> }): Promise<unknown> => {
          void args;
          return Promise.resolve(undefined);
        },
      ),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(
        (args: {
          where: Record<string, unknown>;
          data: Record<string, unknown>;
        }): Promise<{ count: number }> => {
          void args;
          return Promise.resolve({ count: 0 });
        },
      ),
    };
    const identifiedBarcode = {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const transactionClient = { packagedProduct, identifiedBarcode };
    const prisma = {
      packagedProduct,
      identifiedBarcode,
      $transaction: jest.fn(
        <T>(callback: (tx: typeof transactionClient) => Promise<T>) =>
          callback(transactionClient),
      ),
    };
    const service = new PackagedProductService(prisma as never);
    return { service, prisma };
  }

  describe('fillPortionGaps', () => {
    it('fills unusable portion gaps and advances the completed-check timestamp without writing nutrition', async () => {
      const { service, prisma } = buildService();
      const existing = productRow({
        packageSize: new Prisma.Decimal(0),
        packageBaseUnit: BaseUnit.G,
      });
      const refreshed = productRow({
        packageSize: new Prisma.Decimal(330),
        packageBaseUnit: BaseUnit.ML,
        servingSize: new Prisma.Decimal(30),
        servingBaseUnit: BaseUnit.G,
        containerKey: ContainerKey.CAN,
        lastProviderCheckAt: checkedAt,
      });
      prisma.packagedProduct.updateMany.mockResolvedValue({ count: 1 });
      prisma.packagedProduct.findUniqueOrThrow.mockResolvedValue(refreshed);

      await expect(
        service.fillPortionGaps(existing, providerResult, checkedAt),
      ).resolves.toBe(refreshed);

      const writes = prisma.packagedProduct.updateMany.mock.calls.map(
        ([args]) => args,
      );
      expect(writes.map(({ data }) => data)).toEqual([
        {
          packageSize: 330,
          packageBaseUnit: BaseUnit.ML,
        },
        {
          servingSize: 60,
          servingBaseUnit: BaseUnit.G,
        },
        { containerKey: ContainerKey.JAR },
        { lastProviderCheckAt: checkedAt },
      ]);
      for (const { where, data: writtenData } of writes) {
        expect(where).toMatchObject({
          id: existing.id,
          source: ProductSource.OPEN_FOOD_FACTS,
          verificationStatus: { not: VerificationStatus.VERIFIED },
        });
        expect(writtenData).not.toHaveProperty('caloriesPer100g');
        expect(writtenData).not.toHaveProperty('proteinPer100g');
        expect(writtenData).not.toHaveProperty('carbsPer100g');
        expect(writtenData).not.toHaveProperty('fatPer100g');
      }
    });

    it('keeps every usable portion value and only advances the timestamp', async () => {
      const { service, prisma } = buildService();
      const existing = productRow({
        packageSize: new Prisma.Decimal(400),
        packageBaseUnit: BaseUnit.G,
        servingSize: new Prisma.Decimal(50),
        servingBaseUnit: BaseUnit.G,
        containerKey: ContainerKey.BOX,
      });
      const refreshed = productRow({
        ...existing,
        lastProviderCheckAt: checkedAt,
      });
      prisma.packagedProduct.updateMany.mockResolvedValue({ count: 1 });
      prisma.packagedProduct.findUniqueOrThrow.mockResolvedValue(refreshed);

      await service.fillPortionGaps(existing, providerResult, checkedAt);

      expect(prisma.packagedProduct.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.packagedProduct.updateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          source: ProductSource.OPEN_FOOD_FACTS,
          verificationStatus: { not: VerificationStatus.VERIFIED },
        },
        data: { lastProviderCheckAt: checkedAt },
      });
    });

    it('advances only the timestamp when the provider still has no usable portion metadata', async () => {
      const { service, prisma } = buildService();
      const existing = productRow();
      const checked = productRow({ lastProviderCheckAt: checkedAt });
      prisma.packagedProduct.updateMany.mockResolvedValue({ count: 1 });
      prisma.packagedProduct.findUniqueOrThrow.mockResolvedValue(checked);

      await expect(
        service.fillPortionGaps(existing, {}, checkedAt),
      ).resolves.toBe(checked);
      expect(prisma.packagedProduct.updateMany).toHaveBeenCalledWith({
        where: {
          id: existing.id,
          source: ProductSource.OPEN_FOOD_FACTS,
          verificationStatus: { not: VerificationStatus.VERIFIED },
        },
        data: { lastProviderCheckAt: checkedAt },
      });
    });

    it('does not modify a row that became VERIFIED after it was read', async () => {
      const { service, prisma } = buildService();
      const stale = productRow();
      const current = productRow({
        verificationStatus: VerificationStatus.VERIFIED,
      });
      prisma.packagedProduct.updateMany.mockResolvedValue({ count: 0 });
      prisma.packagedProduct.findUniqueOrThrow.mockResolvedValue(current);

      await expect(
        service.fillPortionGaps(stale, providerResult, checkedAt),
      ).resolves.toBe(current);

      for (const [{ where }] of prisma.packagedProduct.updateMany.mock.calls) {
        expect(where).toMatchObject({
          id: stale.id,
          source: ProductSource.OPEN_FOOD_FACTS,
          verificationStatus: { not: VerificationStatus.VERIFIED },
        });
      }
      expect(current).toEqual(
        productRow({ verificationStatus: VerificationStatus.VERIFIED }),
      );
    });

    it('does not overwrite a package filled by another writer after the initial read', async () => {
      const { service, prisma } = buildService();
      const stale = productRow();
      const concurrent = productRow({
        packageSize: new Prisma.Decimal(500),
        packageBaseUnit: BaseUnit.G,
        lastProviderCheckAt: checkedAt,
      });
      prisma.packagedProduct.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 1 });
      prisma.packagedProduct.findUniqueOrThrow.mockResolvedValue(concurrent);

      await expect(
        service.fillPortionGaps(
          stale,
          {
            packageSize: 330,
            packageBaseUnit: BaseUnit.ML,
          },
          checkedAt,
        ),
      ).resolves.toBe(concurrent);

      expect(prisma.packagedProduct.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: stale.id,
          source: ProductSource.OPEN_FOOD_FACTS,
          verificationStatus: { not: VerificationStatus.VERIFIED },
          OR: [
            { packageSize: null },
            { packageSize: { lte: 0 } },
            { packageBaseUnit: null },
          ],
        },
        data: {
          packageSize: 330,
          packageBaseUnit: BaseUnit.ML,
        },
      });
      expect(concurrent.packageSize).toEqual(new Prisma.Decimal(500));
      expect(concurrent.packageBaseUnit).toBe(BaseUnit.G);
    });

    it.each([
      [
        'USER_SUBMITTED',
        ProductSource.USER_SUBMITTED,
        VerificationStatus.UNVERIFIED,
      ],
      ['ADMIN', ProductSource.ADMIN, VerificationStatus.UNVERIFIED],
      ['VERIFIED', ProductSource.OPEN_FOOD_FACTS, VerificationStatus.VERIFIED],
    ] as const)(
      'skips %s products without advancing their timestamp',
      async (_label, source, verificationStatus) => {
        const { service, prisma } = buildService();
        const existing = productRow({ source, verificationStatus });

        await expect(
          service.fillPortionGaps(existing, providerResult, checkedAt),
        ).resolves.toBe(existing);
        expect(prisma.packagedProduct.updateMany).not.toHaveBeenCalled();
        expect(prisma.packagedProduct.findUniqueOrThrow).not.toHaveBeenCalled();
      },
    );
  });

  describe('upsertFromProvider', () => {
    it.each([0, -1, Number.NaN])(
      'refuses to persist unusable provider calories (%s)',
      async (caloriesPer100g) => {
        const { service, prisma } = buildService();

        await expect(
          service.upsertFromProvider(
            barcode,
            { ...providerResult, caloriesPer100g },
            ProductSource.OPEN_FOOD_FACTS,
          ),
        ).rejects.toThrow('does not have usable calories');
        expect(prisma.packagedProduct.create).not.toHaveBeenCalled();
      },
    );

    it('creates a new row tagged EXTERNAL with the given source', async () => {
      const { service, prisma } = buildService();
      const created = { id: 'row-1', barcode };
      prisma.packagedProduct.create.mockResolvedValue(created);

      const result = await service.upsertFromProvider(
        barcode,
        providerResult,
        ProductSource.OPEN_FOOD_FACTS,
      );

      expect(result).toBe(created);
      const data = prisma.packagedProduct.create.mock.calls[0][0].data;
      expect(data.source).toBe(ProductSource.OPEN_FOOD_FACTS);
      expect(data.verificationStatus).toBe(VerificationStatus.EXTERNAL);
      expect(data.caloriesPer100g).toBe(539);
      expect(data.servingSize).toBe(60);
      expect(data.servingBaseUnit).toBe(BaseUnit.G);
      expect(data.packageSize).toBe(330);
      expect(data.packageBaseUnit).toBe(BaseUnit.ML);
      expect(data.containerKey).toBe(ContainerKey.JAR);
    });

    it('stores an absent triplet and PACKAGE when provider Base units and container are absent', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockResolvedValue({ id: 'row-1' });

      await service.upsertFromProvider(
        barcode,
        {
          ...providerResult,
          servingBaseUnit: null,
          packageBaseUnit: null,
          containerKey: null,
          servingUnit: 'raw-serving-token',
          packageUnit: 'raw-package-token',
        },
        ProductSource.OPEN_FOOD_FACTS,
      );

      const data = prisma.packagedProduct.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        servingSize: null,
        servingBaseUnit: null,
        packageSize: null,
        packageBaseUnit: null,
        containerKey: ContainerKey.PACKAGE,
      });
      expect(Object.values(data)).not.toContain('raw-serving-token');
      expect(Object.values(data)).not.toContain('raw-package-token');
    });

    it('stores all-null measurement triplets when a Base unit has no size', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockResolvedValue({ id: 'row-1' });

      await service.upsertFromProvider(
        barcode,
        {
          ...providerResult,
          servingSize: null,
          servingBaseUnit: BaseUnit.G,
          packageSize: null,
          packageBaseUnit: BaseUnit.ML,
        },
        ProductSource.OPEN_FOOD_FACTS,
      );

      expect(prisma.packagedProduct.create.mock.calls[0][0].data).toMatchObject(
        {
          servingSize: null,
          servingBaseUnit: null,
          packageSize: null,
          packageBaseUnit: null,
        },
      );
    });

    it('returns the existing row instead of duplicating when two requests race on the same new barcode', async () => {
      const { service, prisma } = buildService();
      const existing = { id: 'row-1', barcode };
      prisma.packagedProduct.create.mockRejectedValue(uniqueBarcodeViolation());
      prisma.packagedProduct.findUniqueOrThrow.mockResolvedValue(existing);

      const result = await service.upsertFromProvider(
        barcode,
        providerResult,
        ProductSource.OPEN_FOOD_FACTS,
      );

      expect(result).toBe(existing);
      expect(prisma.packagedProduct.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { barcode },
      });
    });

    it('re-throws an unrelated database error rather than masking it as a race', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.upsertFromProvider(
          barcode,
          providerResult,
          ProductSource.OPEN_FOOD_FACTS,
        ),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('createUserSubmitted', () => {
    const validDto = {
      barcode,
      name: 'Homemade Molokhia Mix',
      declaredNutritionBasis: NutritionBasis.PER_100_G,
      caloriesPer100g: 90,
      proteinPer100g: 4,
      carbsPer100g: 10,
      fatPer100g: 3,
    };

    it('normalizes the barcode and creates the product as USER_SUBMITTED/UNVERIFIED', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockResolvedValue({
        id: 'row-1',
        ...validDto,
      });

      await service.createUserSubmitted(validDto);

      const data = prisma.packagedProduct.create.mock.calls[0][0].data;
      expect(data.source).toBe(ProductSource.USER_SUBMITTED);
      expect(data.verificationStatus).toBe(VerificationStatus.UNVERIFIED);
      expect(data.barcode).toBe(barcode);
      expect(data.declaredNutritionBasis).toBe(NutritionBasis.PER_100_G);
      expect(prisma.identifiedBarcode.deleteMany).toHaveBeenCalledWith({
        where: { barcode },
      });
    });

    it('rejects a submission without a Declared basis', async () => {
      const { service, prisma } = buildService();
      const withoutBasis = { ...validDto } as Partial<typeof validDto>;
      delete withoutBasis.declaredNutritionBasis;

      await expect(
        service.createUserSubmitted(withoutBasis as never),
      ).rejects.toMatchObject({
        response: { reason: 'DECLARED_NUTRITION_BASIS_REQUIRED' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects PER_100_G with a 330 ml package as a dimension conflict', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.createUserSubmitted({
          ...validDto,
          packageSize: 330,
          packageUnit: 'ml',
        }),
      ).rejects.toMatchObject({
        response: { reason: 'DIMENSION_BASIS_CONFLICT' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts a VOLUME package with a MASS serving and resolution discards the serving', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockResolvedValue({ id: 'row-1' });

      await service.createUserSubmitted({
        ...validDto,
        declaredNutritionBasis: NutritionBasis.PER_100_ML,
        packageSize: 330,
        packageUnit: 'ml',
        servingSize: 30,
        servingUnit: 'g',
      });

      const data = prisma.packagedProduct.create.mock.calls[0][0].data;
      const result = resolvePackagedProductPortion(
        productRow({
          source: ProductSource.USER_SUBMITTED,
          packageSize: new Prisma.Decimal(data.packageSize as number),
          packageBaseUnit: data.packageBaseUnit as BaseUnit,
          servingSize: new Prisma.Decimal(data.servingSize as number),
          servingBaseUnit: data.servingBaseUnit as BaseUnit,
          declaredNutritionBasis: data.declaredNutritionBasis as NutritionBasis,
        }),
      );
      expect(result.resolution).toMatchObject({
        outcome: 'LOGGABLE',
        portionDimension: 'VOLUME',
        package: { size: 330, baseUnit: BaseUnit.ML },
        serving: null,
      });
      expect(result.diagnostics.servingDiscardReason).toBe(
        'DIMENSION_MISMATCH',
      );
    });

    it('accepts PER_100_ML without package or serving as loggable Scenario E', async () => {
      const { service, prisma } = buildService();
      const created = productRow({
        source: ProductSource.USER_SUBMITTED,
        declaredNutritionBasis: NutritionBasis.PER_100_ML,
      });
      prisma.packagedProduct.create.mockResolvedValue(created);

      await expect(
        service.createUserSubmitted({
          ...validDto,
          declaredNutritionBasis: NutritionBasis.PER_100_ML,
        }),
      ).resolves.toBe(created);
      expect(resolvePackagedProductPortion(created).resolution).toMatchObject({
        outcome: 'LOGGABLE',
        portionDimension: 'VOLUME',
        package: null,
        serving: null,
      });
    });

    it('normalizes decimal litre input into the Base-unit columns', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockResolvedValue({ id: 'row-1' });

      await service.createUserSubmitted({
        ...validDto,
        declaredNutritionBasis: NutritionBasis.PER_100_ML,
        packageSize: 1.5,
        packageUnit: 'L',
      });

      expect(prisma.packagedProduct.create.mock.calls[0][0].data).toMatchObject(
        {
          packageSize: 1500,
          packageBaseUnit: BaseUnit.ML,
        },
      );
    });

    it('stores a bare oz package as absent and still creates the product', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockResolvedValue({ id: 'row-1' });

      await service.createUserSubmitted({
        ...validDto,
        packageSize: 12.5,
        packageUnit: 'oz',
      });

      expect(prisma.packagedProduct.create.mock.calls[0][0].data).toMatchObject(
        {
          packageSize: null,
          packageBaseUnit: null,
        },
      );
    });

    it.each(['oz', 'portion', 'mystery-unit'])(
      'stores an unsupported serving unit (%s) as absent without rejecting',
      async (servingUnit) => {
        const { service, prisma } = buildService();
        prisma.packagedProduct.create.mockResolvedValue({ id: 'row-1' });

        await service.createUserSubmitted({
          ...validDto,
          servingSize: 12.5,
          servingUnit,
        });

        expect(
          prisma.packagedProduct.create.mock.calls[0][0].data,
        ).toMatchObject({
          servingSize: null,
          servingBaseUnit: null,
        });
      },
    );

    it('leaves the identification untouched when product creation fails', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockRejectedValue(
        new Error('product insert failed'),
      );

      await expect(service.createUserSubmitted(validDto)).rejects.toThrow(
        'product insert failed',
      );
      expect(prisma.identifiedBarcode.deleteMany).not.toHaveBeenCalled();
    });

    it('rolls back product creation when identification removal fails', async () => {
      const persisted: { product: Record<string, unknown> | null } = {
        product: null,
      };
      const prisma = {
        packagedProduct: {},
        $transaction: jest.fn(
          async <T>(
            callback: (tx: {
              packagedProduct: {
                create: (args: {
                  data: Record<string, unknown>;
                }) => Promise<unknown>;
              };
              identifiedBarcode: {
                deleteMany: () => Promise<never>;
              };
            }) => Promise<T>,
          ) => {
            let stagedProduct: Record<string, unknown> | null = null;
            const result = await callback({
              packagedProduct: {
                create: ({ data }) => {
                  stagedProduct = data;
                  return Promise.resolve({ id: 'row-1', ...data });
                },
              },
              identifiedBarcode: {
                deleteMany: () =>
                  Promise.reject(new Error('identification removal failed')),
              },
            });
            persisted.product = stagedProduct;
            return result;
          },
        ),
      };
      const service = new PackagedProductService(prisma as never);

      await expect(service.createUserSubmitted(validDto)).rejects.toThrow(
        'identification removal failed',
      );
      expect(persisted.product).toBeNull();
    });

    it('rejects a barcode that is not a valid EAN-13/EAN-8/UPC-A/UPC-E with 400, not 409', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.createUserSubmitted({
          ...validDto,
          barcode: 'not-a-barcode',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.packagedProduct.create).not.toHaveBeenCalled();
    });

    it('rejects a corrupted GS1 check digit before saving', async () => {
      const { service, prisma } = buildService();

      await expect(
        service.createUserSubmitted({
          ...validDto,
          barcode: '3017620422004',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.packagedProduct.create).not.toHaveBeenCalled();
    });

    it('rejects a submission for a barcode that already exists', async () => {
      const { service, prisma } = buildService();
      prisma.packagedProduct.create.mockRejectedValue(uniqueBarcodeViolation());

      await expect(
        service.createUserSubmitted(validDto as never),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.identifiedBarcode.deleteMany).not.toHaveBeenCalled();
    });
  });
});
