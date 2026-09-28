import {
  BadRequestException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BaseUnit,
  ContainerKey,
  IdentifiedBarcodeReason,
  NutritionBasis,
  Prisma,
  ProductSource,
  VerificationStatus,
  type IdentifiedBarcode,
  type PackagedProduct,
} from '@prisma/client';
import { ProductResolverService } from '../../src/modules/food/product-resolver.service';
import { TransientProviderBackoff } from '../../src/modules/food/provider-retry-policy';

describe('ProductResolverService.resolveBarcode', () => {
  const barcode = '3017620422003';
  const now = new Date('2026-09-28T12:00:00.000Z');

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
      servingUnit: null,
      servingBaseUnit: null,
      packageSize: new Prisma.Decimal(400),
      packageUnit: 'g',
      packageBaseUnit: BaseUnit.G,
      containerKey: ContainerKey.JAR,
      declaredNutritionBasis: null,
      caloriesPer100g: new Prisma.Decimal(539),
      proteinPer100g: null,
      carbsPer100g: null,
      fatPer100g: null,
      fiberPer100g: null,
      sugarPer100g: null,
      sodiumPer100g: null,
      imageUrl: null,
      country: null,
      source: ProductSource.OPEN_FOOD_FACTS,
      sourceId: barcode,
      verificationStatus: VerificationStatus.EXTERNAL,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
  }

  function identificationRow(
    overrides: Partial<IdentifiedBarcode> = {},
  ): IdentifiedBarcode {
    return {
      id: 'identification-1',
      barcode,
      displayName: 'Known regional snack',
      brand: 'Regional Foods',
      imageUrl: 'https://images.example/regional-snack.jpg',
      reason: IdentifiedBarcodeReason.NUTRITION_MISSING,
      source: ProductSource.OPEN_FOOD_FACTS,
      lastProviderCheckAt: new Date('2026-09-20T12:00:00.000Z'),
      createdAt: new Date('2026-09-20T12:00:00.000Z'),
      updatedAt: new Date('2026-09-20T12:00:00.000Z'),
      ...overrides,
    };
  }

  const cataloguedResult = {
    outcome: 'FOUND_WITH_NUTRITION' as const,
    product: {
      name: 'Now complete',
      caloriesPer100g: 250,
      packageSize: 100,
      packageBaseUnit: BaseUnit.G,
    },
  };
  const identifiedResult = {
    outcome: 'FOUND_WITHOUT_NUTRITION' as const,
    identification: {
      name: 'Known regional snack',
      brand: 'Regional Foods',
      imageUrl: 'https://images.example/regional-snack.jpg',
    },
  };
  const expectedResolution = {
    outcome: 'LOGGABLE',
    portionDimension: 'MASS',
    effectiveNutritionBasis: {
      basis: NutritionBasis.PER_100_G,
      origin: 'INFERRED',
      source: ProductSource.OPEN_FOOD_FACTS,
      ruleId: 'OPEN_FOOD_FACTS_PORTION_DIMENSION',
    },
    package: { size: 400, baseUnit: BaseUnit.G },
    serving: null,
    containerKey: ContainerKey.JAR,
  };

  function buildService() {
    const transactionClient = {
      identifiedBarcode: {
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      packagedProduct: { findUniqueOrThrow: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(transactionClient),
      ),
    };
    const packagedProducts = {
      findByBarcode: jest.fn(),
      upsertFromProvider: jest.fn(),
      createFromProvider: jest.fn(),
    };
    const identifiedBarcodes = {
      findByBarcode: jest.fn(),
      upsertNutritionMissing: jest.fn(),
      advanceProviderCheck: jest.fn(),
    };
    const openFoodFacts = {
      source: ProductSource.OPEN_FOOD_FACTS,
      lookupByBarcode: jest.fn(),
    };
    const backoff = new TransientProviderBackoff();
    const service = new ProductResolverService(
      prisma as never,
      packagedProducts as never,
      identifiedBarcodes as never,
      backoff,
      openFoodFacts as never,
    );
    return {
      service,
      prisma,
      transactionClient,
      packagedProducts,
      identifiedBarcodes,
      openFoodFacts,
    };
  }

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns a PackagedProduct first and never consults a stale identification', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const product = productRow();
    packagedProducts.findByBarcode.mockResolvedValue(product);

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'found',
      product,
      resolution: expectedResolution,
    });
    expect(identifiedBarcodes.findByBarcode).not.toHaveBeenCalled();
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });

  it('returns an identification inside its 30-day window without a provider call', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const identification = identificationRow();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(identification);

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'identified',
      identification,
    });
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });

  it('calls the provider exactly once after the retry window', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const stale = identificationRow({
      lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const refreshed = identificationRow({ lastProviderCheckAt: now });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
    identifiedBarcodes.upsertNutritionMissing.mockResolvedValue(refreshed);
    openFoodFacts.lookupByBarcode.mockResolvedValue(identifiedResult);

    await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(1);
    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledWith(barcode);
  });

  it('advances the check timestamp when nutrition is still missing', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const stale = identificationRow({
      lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const refreshed = identificationRow({ lastProviderCheckAt: now });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
    identifiedBarcodes.upsertNutritionMissing.mockResolvedValue(refreshed);
    openFoodFacts.lookupByBarcode.mockResolvedValue(identifiedResult);

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'identified',
      identification: refreshed,
    });
    expect(identifiedBarcodes.upsertNutritionMissing).toHaveBeenCalledWith(
      barcode,
      identifiedResult.identification,
      ProductSource.OPEN_FOOD_FACTS,
      now,
    );
  });

  it('treats not found as a completed check and advances the timestamp', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const stale = identificationRow({
      lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const refreshed = identificationRow({ lastProviderCheckAt: now });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
    identifiedBarcodes.advanceProviderCheck.mockResolvedValue(refreshed);
    openFoodFacts.lookupByBarcode.mockResolvedValue({ outcome: 'NOT_FOUND' });

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'identified',
      identification: refreshed,
    });
    expect(identifiedBarcodes.advanceProviderCheck).toHaveBeenCalledWith(
      barcode,
      now,
    );
  });

  it.each(['timeout', 'network failure', 'HTTP 5xx', 'unparseable 200'])(
    'keeps the stored and returned identification unchanged after %s',
    async (failure) => {
      const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
        buildService();
      const stale = identificationRow({
        lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      packagedProducts.findByBarcode.mockResolvedValue(null);
      identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
      openFoodFacts.lookupByBarcode.mockRejectedValue(
        new ServiceUnavailableException(failure),
      );

      await expect(service.resolveBarcode(barcode)).resolves.toEqual({
        status: 'identified',
        identification: stale,
      });
      expect(identifiedBarcodes.advanceProviderCheck).not.toHaveBeenCalled();
      expect(identifiedBarcodes.upsertNutritionMissing).not.toHaveBeenCalled();
    },
  );

  it('isolates a non-transient recheck error without backing off or advancing the timestamp', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const stale = identificationRow({
      lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
    openFoodFacts.lookupByBarcode.mockRejectedValue(
      new TypeError('provider mapping bug'),
    );

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'identified',
      identification: stale,
    });
    await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(2);
    expect(identifiedBarcodes.advanceProviderCheck).not.toHaveBeenCalled();
    expect(identifiedBarcodes.upsertNutritionMissing).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('TypeError: provider mapping bug'),
    );
  });

  it('backs off repeated stale-record scans without advancing the completed-check timestamp', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const stale = identificationRow({
      lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
    openFoodFacts.lookupByBarcode.mockRejectedValue(
      new ServiceUnavailableException('OFF unavailable'),
    );

    await service.resolveBarcode(barcode);
    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'identified',
      identification: stale,
    });

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(1);
    expect(identifiedBarcodes.advanceProviderCheck).not.toHaveBeenCalled();
    expect(identifiedBarcodes.upsertNutritionMissing).not.toHaveBeenCalled();
  });

  it('creates an identity-only record for a first found-without-calories response', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const saved = identificationRow({ lastProviderCheckAt: now });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.upsertNutritionMissing.mockResolvedValue(saved);
    openFoodFacts.lookupByBarcode.mockResolvedValue(identifiedResult);

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'identified',
      identification: saved,
    });
    expect(packagedProducts.upsertFromProvider).not.toHaveBeenCalled();
  });

  it('atomically removes a concurrently-created identification on a first-scan product hit', async () => {
    const {
      service,
      packagedProducts,
      identifiedBarcodes,
      openFoodFacts,
      transactionClient,
    } = buildService();
    const created = productRow({ name: 'First-scan product' });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue(cataloguedResult);
    packagedProducts.createFromProvider.mockResolvedValue(created);

    await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
      status: 'found',
      product: created,
    });
    expect(packagedProducts.createFromProvider).toHaveBeenCalledWith(
      barcode,
      cataloguedResult.product,
      ProductSource.OPEN_FOOD_FACTS,
      transactionClient,
    );
    expect(transactionClient.identifiedBarcode.deleteMany).toHaveBeenCalledWith(
      { where: { barcode } },
    );
    expect(packagedProducts.upsertFromProvider).not.toHaveBeenCalled();
  });

  it('atomically creates a product and removes its identification on recovery', async () => {
    const {
      service,
      packagedProducts,
      identifiedBarcodes,
      openFoodFacts,
      transactionClient,
    } = buildService();
    const stale = identificationRow({
      lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const created = productRow({ name: 'Now complete' });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
    openFoodFacts.lookupByBarcode.mockResolvedValue(cataloguedResult);
    packagedProducts.createFromProvider.mockResolvedValue(created);

    await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
      status: 'found',
      product: created,
    });
    expect(packagedProducts.createFromProvider).toHaveBeenCalledWith(
      barcode,
      cataloguedResult.product,
      ProductSource.OPEN_FOOD_FACTS,
      transactionClient,
    );
    expect(transactionClient.identifiedBarcode.deleteMany).toHaveBeenCalledWith(
      {
        where: { barcode },
      },
    );
  });

  it.each(['create', 'delete'] as const)(
    'rolls back both supersession halves when %s fails',
    async (failingHalf) => {
      const {
        service,
        prisma,
        packagedProducts,
        identifiedBarcodes,
        openFoodFacts,
      } = buildService();
      const stale = identificationRow({
        lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
      });
      const created = productRow({ name: 'Now complete' });
      const persisted: {
        product: PackagedProduct | null;
        identification: IdentifiedBarcode | null;
      } = { product: null, identification: stale };

      packagedProducts.findByBarcode.mockResolvedValue(null);
      identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
      openFoodFacts.lookupByBarcode.mockResolvedValue(cataloguedResult);
      prisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<unknown>) => {
          const staged = { ...persisted };
          const tx = {
            packagedProduct: {},
            identifiedBarcode: {
              deleteMany: jest.fn(() => {
                if (failingHalf === 'delete') {
                  throw new Error('delete failed');
                }
                staged.identification = null;
                return { count: 1 };
              }),
            },
          };
          packagedProducts.createFromProvider.mockImplementation(() => {
            if (failingHalf === 'create') {
              throw new Error('create failed');
            }
            staged.product = created;
            return created;
          });
          const result = await callback(tx);
          persisted.product = staged.product;
          persisted.identification = staged.identification;
          return result;
        },
      );

      await expect(service.resolveBarcode(barcode)).rejects.toThrow(
        `${failingHalf} failed`,
      );
      expect(persisted).toEqual({ product: null, identification: stale });
    },
  );

  it('handles a unique race by using the winning product and deleting the identification transactionally', async () => {
    const {
      service,
      prisma,
      packagedProducts,
      identifiedBarcodes,
      openFoodFacts,
    } = buildService();
    const stale = identificationRow({
      lastProviderCheckAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    const winner = productRow({ id: 'race-winner', name: 'Now complete' });
    const uniqueError = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['barcode'] },
    });
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(stale);
    openFoodFacts.lookupByBarcode.mockResolvedValue(cataloguedResult);
    packagedProducts.createFromProvider.mockRejectedValue(uniqueError);
    prisma.$transaction
      .mockImplementationOnce((callback: (tx: unknown) => unknown) =>
        callback({
          packagedProduct: {},
          identifiedBarcode: { deleteMany: jest.fn() },
        }),
      )
      .mockImplementationOnce((callback: (tx: unknown) => unknown) =>
        callback({
          packagedProduct: {
            findUniqueOrThrow: jest.fn().mockResolvedValue(winner),
          },
          identifiedBarcode: { deleteMany },
        }),
      );

    await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
      status: 'found',
      product: winner,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledWith({ where: { barcode } });
  });

  it('returns not_found for a genuinely unknown barcode', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue({ outcome: 'NOT_FOUND' });

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'not_found',
    });
  });

  it('returns unavailable when a provider outage has no cached identity', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockRejectedValue(
      new ServiceUnavailableException('OFF unavailable'),
    );

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('isolates a non-transient first-scan error as unavailable without backing it off', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockRejectedValue(
      new TypeError('provider mapping bug'),
    );

    await expect(service.resolveBarcode(barcode)).resolves.toEqual({
      status: 'unavailable',
    });
    await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('TypeError: provider mapping bug'),
    );
  });

  it('does not misreport product persistence failure as provider unavailability', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    identifiedBarcodes.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue(cataloguedResult);
    packagedProducts.createFromProvider.mockRejectedValue(
      new Error('database connection lost'),
    );

    await expect(service.resolveBarcode(barcode)).rejects.toThrow(
      'database connection lost',
    );
  });

  it('rejects invalid input before touching either local table or a provider', async () => {
    const { service, packagedProducts, identifiedBarcodes, openFoodFacts } =
      buildService();

    await expect(
      service.resolveBarcode('not-a-barcode'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(packagedProducts.findByBarcode).not.toHaveBeenCalled();
    expect(identifiedBarcodes.findByBarcode).not.toHaveBeenCalled();
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });

  it('still logs discarded serving diagnostics for local products', async () => {
    const { service, packagedProducts } = buildService();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    packagedProducts.findByBarcode.mockResolvedValue(
      productRow({
        packageSize: new Prisma.Decimal(330),
        packageUnit: 'ml',
        packageBaseUnit: BaseUnit.ML,
        servingSize: new Prisma.Decimal(330),
        servingUnit: 'g',
        servingBaseUnit: BaseUnit.G,
        containerKey: ContainerKey.CAN,
      }),
    );

    await service.resolveBarcode(barcode);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('DIMENSION_MISMATCH'),
    );
  });
});
