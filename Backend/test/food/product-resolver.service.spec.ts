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
import {
  TRANSIENT_PROVIDER_BACKOFF_MS,
  TransientProviderBackoff,
} from '../../src/modules/food/provider-retry-policy';

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
      servingBaseUnit: null,
      packageSize: new Prisma.Decimal(400),
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
      lastProviderCheckAt: null,
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

  function unknownPortionProduct(
    overrides: Partial<PackagedProduct> = {},
  ): PackagedProduct {
    return productRow({
      packageSize: null,
      packageBaseUnit: null,
      servingSize: null,
      servingBaseUnit: null,
      containerKey: ContainerKey.PACKAGE,
      ...overrides,
    });
  }

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
      fillPortionGaps: jest.fn(),
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
      backoff,
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

  it('does not re-query a local product with a usable serving and no package', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValue(
      productRow({
        packageSize: null,
        packageBaseUnit: null,
        servingSize: new Prisma.Decimal(30),
        servingBaseUnit: BaseUnit.G,
      }),
    );

    await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });

  it('advances only the timestamp when a completed product re-check still has no usable portion metadata', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const cached = unknownPortionProduct();
    const checked = unknownPortionProduct({ lastProviderCheckAt: now });
    const response = {
      outcome: 'FOUND_WITHOUT_NUTRITION' as const,
      identification: {
        name: 'Cached product',
        brand: null,
        imageUrl: null,
      },
    };
    packagedProducts.findByBarcode.mockResolvedValue(cached);
    packagedProducts.fillPortionGaps.mockResolvedValue(checked);
    openFoodFacts.lookupByBarcode.mockResolvedValue(response);

    await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
      status: 'found',
      product: checked,
      resolution: {
        outcome: 'NOT_LOGGABLE',
        primaryReason: 'PORTION_DIMENSION_UNKNOWN',
      },
    });
    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledWith(barcode);
    expect(packagedProducts.fillPortionGaps).toHaveBeenCalledWith(
      cached,
      response.identification,
      now,
    );
  });

  it('fills returned portion gaps and becomes loggable in the same scan', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const cached = unknownPortionProduct();
    const response = {
      outcome: 'FOUND_WITH_NUTRITION' as const,
      product: {
        name: 'Provider product',
        caloriesPer100g: 999,
        packageSize: 330,
        packageBaseUnit: BaseUnit.ML,
        containerKey: ContainerKey.CAN,
      },
    };
    const refreshed = unknownPortionProduct({
      packageSize: new Prisma.Decimal(330),
      packageBaseUnit: BaseUnit.ML,
      containerKey: ContainerKey.CAN,
      lastProviderCheckAt: now,
    });
    packagedProducts.findByBarcode.mockResolvedValue(cached);
    packagedProducts.fillPortionGaps.mockResolvedValue(refreshed);
    openFoodFacts.lookupByBarcode.mockResolvedValue(response);

    await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
      status: 'found',
      product: refreshed,
      resolution: {
        outcome: 'LOGGABLE',
        portionDimension: 'VOLUME',
        package: { size: 330, baseUnit: BaseUnit.ML },
      },
    });
    expect(packagedProducts.fillPortionGaps).toHaveBeenCalledWith(
      cached,
      response.product,
      now,
    );
  });

  it('treats a removed OFF product as a completed check and leaves its fields untouched', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const cached = unknownPortionProduct();
    const checked = unknownPortionProduct({ lastProviderCheckAt: now });
    packagedProducts.findByBarcode.mockResolvedValue(cached);
    packagedProducts.fillPortionGaps.mockResolvedValue(checked);
    openFoodFacts.lookupByBarcode.mockResolvedValue({ outcome: 'NOT_FOUND' });

    await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
      status: 'found',
      product: checked,
    });
    expect(packagedProducts.fillPortionGaps).toHaveBeenCalledWith(
      cached,
      {},
      now,
    );
  });

  it('does not re-check an unknown-portion product inside its 30-day window', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValue(
      unknownPortionProduct({
        lastProviderCheckAt: new Date('2026-08-30T12:00:00.001Z'),
      }),
    );

    await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });

  it('re-checks an unknown-portion product when 30 days have elapsed', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const stale = unknownPortionProduct({
      lastProviderCheckAt: new Date('2026-08-29T12:00:00.000Z'),
    });
    const checked = unknownPortionProduct({ lastProviderCheckAt: now });
    packagedProducts.findByBarcode.mockResolvedValue(stale);
    packagedProducts.fillPortionGaps.mockResolvedValue(checked);
    openFoodFacts.lookupByBarcode.mockResolvedValue({ outcome: 'NOT_FOUND' });

    await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(1);
  });

  it.each(['timeout', 'network failure', 'HTTP 5xx', 'unparseable body'])(
    'returns the cached product unchanged and writes nothing after %s',
    async (failure) => {
      const { service, packagedProducts, openFoodFacts } = buildService();
      const cached = unknownPortionProduct();
      packagedProducts.findByBarcode.mockResolvedValue(cached);
      openFoodFacts.lookupByBarcode.mockRejectedValue(
        new ServiceUnavailableException(failure),
      );

      await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
        status: 'found',
        product: cached,
      });
      expect(packagedProducts.fillPortionGaps).not.toHaveBeenCalled();
    },
  );

  it('backs off a product re-check for 60 seconds after a transient failure', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const cached = unknownPortionProduct();
    packagedProducts.findByBarcode.mockResolvedValue(cached);
    openFoodFacts.lookupByBarcode.mockRejectedValue(
      new ServiceUnavailableException('OFF unavailable'),
    );

    const first = await service.resolveBarcode(barcode);
    jest.advanceTimersByTime(TRANSIENT_PROVIDER_BACKOFF_MS - 1);
    const backedOff = await service.resolveBarcode(barcode);

    expect(first).toMatchObject({ status: 'found', product: cached });
    expect(backedOff).toMatchObject({ status: 'found', product: cached });
    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(1);
    expect(packagedProducts.fillPortionGaps).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    const retried = await service.resolveBarcode(barcode);

    expect(retried).toMatchObject({ status: 'found', product: cached });
    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(2);
    expect(packagedProducts.fillPortionGaps).not.toHaveBeenCalled();
  });

  it('returns the cached product after a non-transient error without writing or backing off', async () => {
    const { service, packagedProducts, openFoodFacts, backoff } =
      buildService();
    const cached = unknownPortionProduct();
    const recordFailure = jest.spyOn(backoff, 'recordFailure');
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    packagedProducts.findByBarcode.mockResolvedValue(cached);
    openFoodFacts.lookupByBarcode.mockRejectedValue(
      new Error('provider adapter bug'),
    );

    const first = await service.resolveBarcode(barcode);
    const second = await service.resolveBarcode(barcode);

    expect(first).toMatchObject({ status: 'found', product: cached });
    expect(second).toMatchObject({ status: 'found', product: cached });
    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(2);
    expect(packagedProducts.fillPortionGaps).not.toHaveBeenCalled();
    expect(recordFailure).not.toHaveBeenCalled();
    expect(cached.lastProviderCheckAt).toBeNull();
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
    'does not re-query an unknown-portion %s product',
    async (_label, source, verificationStatus) => {
      const { service, packagedProducts, openFoodFacts } = buildService();
      packagedProducts.findByBarcode.mockResolvedValue(
        unknownPortionProduct({ source, verificationStatus }),
      );

      await service.resolveBarcode(barcode);

      expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
    },
  );

  it('captures a re-fetched serving in another dimension and discards it during re-resolution', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const cached = unknownPortionProduct();
    const response = {
      outcome: 'FOUND_WITH_NUTRITION' as const,
      product: {
        name: 'Mixed metadata',
        caloriesPer100g: 42,
        packageSize: 330,
        packageBaseUnit: BaseUnit.ML,
        servingSize: 30,
        servingBaseUnit: BaseUnit.G,
      },
    };
    const refreshed = unknownPortionProduct({
      packageSize: new Prisma.Decimal(330),
      packageBaseUnit: BaseUnit.ML,
      servingSize: new Prisma.Decimal(30),
      servingBaseUnit: BaseUnit.G,
      lastProviderCheckAt: now,
    });
    packagedProducts.findByBarcode.mockResolvedValue(cached);
    packagedProducts.fillPortionGaps.mockResolvedValue(refreshed);
    openFoodFacts.lookupByBarcode.mockResolvedValue(response);

    await expect(service.resolveBarcode(barcode)).resolves.toMatchObject({
      status: 'found',
      resolution: {
        outcome: 'LOGGABLE',
        package: { size: 330, baseUnit: BaseUnit.ML },
        serving: null,
      },
    });
    expect(packagedProducts.fillPortionGaps).toHaveBeenCalledWith(
      cached,
      expect.objectContaining({
        servingSize: 30,
        servingBaseUnit: BaseUnit.G,
      }),
      now,
    );
  });

  it('uses one completed-check timestamp across a no-retry then retry sequence', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const first = unknownPortionProduct();
    const checked = unknownPortionProduct({ lastProviderCheckAt: now });
    const checkedAgain = unknownPortionProduct({
      lastProviderCheckAt: new Date('2026-10-28T12:00:00.000Z'),
    });
    packagedProducts.findByBarcode
      .mockResolvedValueOnce(first)
      .mockResolvedValue(checked);
    packagedProducts.fillPortionGaps
      .mockResolvedValueOnce(checked)
      .mockResolvedValueOnce(checkedAgain);
    openFoodFacts.lookupByBarcode.mockResolvedValue({ outcome: 'NOT_FOUND' });

    await service.resolveBarcode(barcode);
    jest.setSystemTime(new Date('2026-10-27T12:00:00.000Z'));
    await service.resolveBarcode(barcode);
    jest.setSystemTime(new Date('2026-10-28T12:00:00.000Z'));
    await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(2);
    expect(packagedProducts.fillPortionGaps).toHaveBeenNthCalledWith(
      2,
      checked,
      {},
      new Date('2026-10-28T12:00:00.000Z'),
    );
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

  it('still logs discarded serving diagnostics without re-querying the provider', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    packagedProducts.findByBarcode.mockResolvedValue(
      productRow({
        packageSize: new Prisma.Decimal(330),
        packageBaseUnit: BaseUnit.ML,
        servingSize: new Prisma.Decimal(330),
        servingBaseUnit: BaseUnit.G,
        containerKey: ContainerKey.CAN,
      }),
    );

    await service.resolveBarcode(barcode);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('DIMENSION_MISMATCH'),
    );
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });
});
