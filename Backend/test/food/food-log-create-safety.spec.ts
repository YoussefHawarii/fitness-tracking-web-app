import { NotFoundException } from '@nestjs/common';
import { FoodService } from '../../src/modules/food/food.service';

describe('FoodService — unit-safe food-log create and update', () => {
  const userId = 'user-1';
  const baseCreate = {
    sourceType: 'PACKAGED_PRODUCT' as const,
    sourceRef: 'product-1',
    amount: 330,
    amountUnit: 'ML' as const,
    portionKind: 'CUSTOM' as const,
    mealCategory: 'LUNCH' as const,
    loggedAtUtc: '2026-09-28T12:00:00.000Z',
  };

  function product(overrides: Record<string, unknown> = {}) {
    return {
      id: 'product-1',
      name: 'Test drink',
      brand: 'Test',
      imageUrl: null,
      source: 'OPEN_FOOD_FACTS',
      packageSize: 600,
      packageBaseUnit: 'ML',
      servingSize: 250,
      servingBaseUnit: 'ML',
      containerKey: 'BOTTLE',
      declaredNutritionBasis: null,
      caloriesPer100g: 42,
      proteinPer100g: 1.25,
      carbsPer100g: 10,
      fatPer100g: 0,
      ...overrides,
    };
  }

  function buildService(
    options: {
      product?: Record<string, unknown> | null;
      existing?: Record<string, unknown> | null;
    } = {},
  ) {
    const created: Record<string, unknown>[] = [];
    const updated: Record<string, unknown>[] = [];
    const existing =
      options.existing === null
        ? null
        : {
            id: 'log-1',
            userId,
            sourceType: 'PACKAGED_PRODUCT',
            sourceRef: 'product-1',
            packagedProductId: 'product-1',
            grams: null,
            amount: 330,
            amountUnit: 'ML',
            portionKind: 'PACKAGE',
            portionMultiplier: 1,
            caloriesComputed: 138.6,
            proteinComputed: 4.125,
            carbsComputed: 33,
            fatComputed: 0,
            mealCategory: 'LUNCH',
            ...options.existing,
          };
    const prisma = {
      foodLogEntry: {
        create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return Promise.resolve({ id: 'log-new', ...data });
        }),
        findFirst: jest.fn().mockResolvedValue(existing),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updated.push(data);
          return Promise.resolve({ ...existing, ...data });
        }),
      },
      localFoodItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'local-1',
          name: 'Local food',
          caloriesPer100g: 200,
          proteinPer100g: null,
          carbsPer100g: null,
          fatPer100g: null,
        }),
      },
      canonicalFood: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'canonical-1',
          nameEn: 'Canonical food',
          nameAr: 'طعام',
          caloriesPer100g: 120,
          proteinPer100g: null,
          carbsPer100g: null,
          fatPer100g: null,
        }),
      },
    };
    const openFoodFacts = { lookupByBarcode: jest.fn() };
    const usda = {
      getById: jest.fn().mockResolvedValue({
        name: 'USDA food',
        caloriesPer100g: 100,
      }),
    };
    const packagedProducts = {
      findById: jest
        .fn()
        .mockResolvedValue(
          options.product === undefined ? product() : options.product,
        ),
    };
    const service = new FoodService(
      prisma as never,
      openFoodFacts as never,
      usda as never,
      { get: jest.fn(), set: jest.fn() } as never,
      { resolveBarcode: jest.fn() } as never,
      packagedProducts as never,
    );
    return { service, prisma, usda, packagedProducts, created, updated };
  }

  function expectedReason(reason: string): { response: { reason: string } } {
    return { response: { reason } };
  }

  it('returns a packaged product with its current portion resolution', async () => {
    const { service, packagedProducts } = buildService();

    const result = await service.getPackagedProduct('product-1');

    expect(packagedProducts.findById).toHaveBeenCalledWith('product-1');
    expect(result).toMatchObject({
      id: 'product-1',
      resolution: {
        outcome: 'LOGGABLE',
        portionDimension: 'VOLUME',
        package: { size: 600, baseUnit: 'ML' },
        serving: { size: 250, baseUnit: 'ML' },
      },
    });
  });

  it('returns 404 when a packaged product id does not exist', async () => {
    const { service, packagedProducts } = buildService();
    packagedProducts.findById.mockResolvedValueOnce(null);

    await expect(service.getPackagedProduct('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('accepts matching volume and mass units and computes on the matching basis', async () => {
    const volume = buildService();
    await volume.service.createFoodLog(userId, baseCreate);
    expect(volume.created[0]).toMatchObject({
      grams: null,
      amount: 330,
      amountUnit: 'ML',
      portionKind: 'CUSTOM',
      portionMultiplier: null,
      caloriesComputed: 138.6,
    });

    const mass = buildService({
      product: product({
        name: 'Test cereal',
        packageSize: 125.5,
        packageBaseUnit: 'G',
        servingSize: 30,
        servingBaseUnit: 'G',
      }),
    });
    await mass.service.createFoodLog(userId, {
      ...baseCreate,
      amount: 100,
      amountUnit: 'G',
    });
    expect(mass.created[0]).toMatchObject({
      grams: 100,
      amount: 100,
      amountUnit: 'G',
      caloriesComputed: 42,
    });
  });

  it.each([
    ['G', product(), 'AMOUNT_UNIT_BASIS_MISMATCH'],
    [
      'ML',
      product({ packageBaseUnit: 'G', servingBaseUnit: 'G' }),
      'AMOUNT_UNIT_BASIS_MISMATCH',
    ],
  ])(
    'rejects %s against the opposite effective basis',
    async (amountUnit, row, reason) => {
      const { service, created } = buildService({ product: row });
      await expect(
        service.createFoodLog(userId, {
          ...baseCreate,
          amountUnit: amountUnit as 'G' | 'ML',
        }),
      ).rejects.toMatchObject(expectedReason(reason));
      expect(created).toHaveLength(0);
    },
  );

  it('rejects a Not scalable product with its primary reason', async () => {
    const { service, created } = buildService({
      product: product({
        source: 'ADMIN',
        packageSize: null,
        packageBaseUnit: null,
        servingSize: null,
        servingBaseUnit: null,
      }),
    });
    await expect(
      service.createFoodLog(userId, baseCreate),
    ).rejects.toMatchObject(expectedReason('PORTION_DIMENSION_UNKNOWN'));
    expect(created).toHaveLength(0);
  });

  it.each([
    [
      'NUTRITION_BASIS_UNKNOWN',
      { source: 'USER_SUBMITTED', declaredNutritionBasis: null },
    ],
    ['DIMENSION_BASIS_CONFLICT', { declaredNutritionBasis: 'PER_100_G' }],
  ])(
    'rejects a Not scalable product with %s and creates nothing',
    async (reason, overrides) => {
      const { service, created } = buildService({
        product: product(overrides),
      });

      await expect(
        service.createFoodLog(userId, baseCreate),
      ).rejects.toMatchObject(expectedReason(reason));
      expect(created).toHaveLength(0);
    },
  );

  it('propagates a packaged-product lookup failure without attempting a create', async () => {
    const failure = new Error('packaged product lookup failed');
    const { service, prisma, packagedProducts, created } = buildService();
    packagedProducts.findById.mockRejectedValueOnce(failure);

    await expect(service.createFoodLog(userId, baseCreate)).rejects.toBe(
      failure,
    );
    expect(prisma.foodLogEntry.create).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });

  it('propagates a create failure without falling back to a grams-only create', async () => {
    const failure = new Error('food log create failed');
    const { service, prisma, created } = buildService();
    prisma.foodLogEntry.create.mockRejectedValueOnce(failure);

    await expect(service.createFoodLog(userId, baseCreate)).rejects.toBe(
      failure,
    );
    expect(prisma.foodLogEntry.create).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(0);
  });

  it('rejects an inconsistent serving choice but accepts the same amount as custom', async () => {
    const inconsistent = buildService();
    await expect(
      inconsistent.service.createFoodLog(userId, {
        ...baseCreate,
        amount: 600,
        portionKind: 'SERVING',
        portionMultiplier: 1,
      }),
    ).rejects.toMatchObject(expectedReason('PORTION_AMOUNT_MISMATCH'));
    expect(inconsistent.created).toHaveLength(0);

    const custom = buildService();
    await custom.service.createFoodLog(userId, {
      ...baseCreate,
      amount: 600,
    });
    expect(custom.created[0]).toMatchObject({
      amount: 600,
      portionKind: 'CUSTOM',
    });
  });

  it('rejects a serving choice when resolution discarded the serving', async () => {
    const { service } = buildService({
      product: product({ servingSize: 900, servingBaseUnit: 'G' }),
    });
    await expect(
      service.createFoodLog(userId, {
        ...baseCreate,
        amount: 900,
        portionKind: 'SERVING',
        portionMultiplier: 1,
      }),
    ).rejects.toMatchObject(expectedReason('SERVING_PORTION_UNAVAILABLE'));
  });

  it('rejects a serving choice when the same-dimension serving exceeds the package', async () => {
    const { service, created } = buildService({
      product: product({ servingSize: 900, servingBaseUnit: 'ML' }),
    });
    await expect(
      service.createFoodLog(userId, {
        ...baseCreate,
        amount: 900,
        portionKind: 'SERVING',
        portionMultiplier: 1,
      }),
    ).rejects.toMatchObject(expectedReason('SERVING_PORTION_UNAVAILABLE'));
    expect(created).toHaveLength(0);
  });

  it('accepts the half-precision tolerance boundary and rounded multiplication', async () => {
    const boundary = buildService({
      product: product({ servingSize: 249.95 }),
    });
    await boundary.service.createFoodLog(userId, {
      ...baseCreate,
      amount: 250,
      portionKind: 'SERVING',
      portionMultiplier: 1,
    });
    expect(boundary.created).toHaveLength(1);

    const rounded = buildService({
      product: product({
        name: 'Mass package',
        packageSize: 125.5,
        packageBaseUnit: 'G',
        servingSize: null,
        servingBaseUnit: null,
      }),
    });
    await rounded.service.createFoodLog(userId, {
      ...baseCreate,
      amount: 62.8,
      amountUnit: 'G',
      portionKind: 'PACKAGE',
      portionMultiplier: 0.5,
    });
    expect(rounded.created[0]).toMatchObject({
      amount: 62.8,
      portionKind: 'PACKAGE',
      portionMultiplier: 0.5,
    });
  });

  it('rejects a legacy grams request for a volume product', async () => {
    const { service } = buildService();
    await expect(
      service.createFoodLog(userId, {
        sourceType: 'PACKAGED_PRODUCT',
        sourceRef: 'product-1',
        grams: 330,
        mealCategory: 'LUNCH',
        loggedAtUtc: baseCreate.loggedAtUtc,
      }),
    ).rejects.toMatchObject(expectedReason('AMOUNT_UNIT_BASIS_MISMATCH'));
  });

  it('rejects new legacy Open Food Facts creates without consulting the provider', async () => {
    const { service, created } = buildService();
    await expect(
      service.createFoodLog(userId, {
        sourceType: 'OPEN_FOOD_FACTS',
        sourceRef: 'barcode',
        grams: 100,
        mealCategory: 'LUNCH',
        loggedAtUtc: baseCreate.loggedAtUtc,
      }),
    ).rejects.toMatchObject(expectedReason('OPEN_FOOD_FACTS_CREATE_RETIRED'));
    expect(created).toHaveLength(0);
  });

  it.each(['LOCAL', 'USDA', 'CANONICAL'] as const)(
    'keeps %s as a grams-only mass source',
    async (sourceType) => {
      const { service, created } = buildService();
      const sourceRef =
        sourceType === 'LOCAL'
          ? 'local-1'
          : sourceType === 'USDA'
            ? 'usda-1'
            : 'canonical-1';
      await service.createFoodLog(userId, {
        sourceType,
        sourceRef,
        amount: 80,
        amountUnit: 'G',
        mealCategory: 'LUNCH',
        loggedAtUtc: baseCreate.loggedAtUtc,
      });
      expect(created[0]).toMatchObject({
        grams: 80,
        amount: 80,
        amountUnit: 'G',
      });

      await expect(
        service.createFoodLog(userId, {
          sourceType,
          sourceRef,
          amount: 80,
          amountUnit: 'ML',
          mealCategory: 'LUNCH',
          loggedAtUtc: baseCreate.loggedAtUtc,
        }),
      ).rejects.toMatchObject(expectedReason('MASS_SOURCE_REQUIRES_G'));
    },
  );

  it.each([
    ['LOCAL', 'local-1', 'PACKAGE', 'PACKAGE_PORTION_UNAVAILABLE'],
    ['USDA', 'usda-1', 'SERVING', 'SERVING_PORTION_UNAVAILABLE'],
    ['CANONICAL', 'canonical-1', 'PACKAGE', 'PACKAGE_PORTION_UNAVAILABLE'],
  ] as const)(
    'rejects a structured %s source choice before provider lookup',
    async (sourceType, sourceRef, portionKind, reason) => {
      const { service, prisma, usda, packagedProducts, created } =
        buildService();

      await expect(
        service.createFoodLog(userId, {
          sourceType,
          sourceRef,
          amount: 80,
          amountUnit: 'G',
          portionKind,
          portionMultiplier: 1,
          mealCategory: 'LUNCH',
          loggedAtUtc: baseCreate.loggedAtUtc,
        }),
      ).rejects.toMatchObject(expectedReason(reason));

      expect(prisma.localFoodItem.findFirst).not.toHaveBeenCalled();
      expect(prisma.canonicalFood.findUnique).not.toHaveBeenCalled();
      expect(usda.getById).not.toHaveBeenCalled();
      expect(packagedProducts.findById).not.toHaveBeenCalled();
      expect(prisma.foodLogEntry.create).not.toHaveBeenCalled();
      expect(created).toHaveLength(0);
    },
  );

  it('continues to accept a custom portion for a grams-only source', async () => {
    const { service, created } = buildService();

    await service.createFoodLog(userId, {
      sourceType: 'LOCAL',
      sourceRef: 'local-1',
      amount: 80,
      amountUnit: 'G',
      portionKind: 'CUSTOM',
      mealCategory: 'LUNCH',
      loggedAtUtc: baseCreate.loggedAtUtc,
    });

    expect(created[0]).toMatchObject({
      portionKind: 'CUSTOM',
      portionMultiplier: null,
    });
  });

  it('updates only mealCategory on an ML entry and preserves every stored value', async () => {
    const { service, prisma, updated } = buildService();
    const result = await service.updateFoodLog(userId, 'log-1', {
      mealCategory: 'DINNER',
    });

    expect(prisma.foodLogEntry.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { mealCategory: 'DINNER' },
    });
    expect(updated).toEqual([{ mealCategory: 'DINNER' }]);
    expect(result).toMatchObject({
      grams: null,
      amount: 330,
      amountUnit: 'ML',
      portionKind: 'PACKAGE',
      portionMultiplier: 1,
      caloriesComputed: 138.6,
      mealCategory: 'DINNER',
    });
  });

  it('edits an ML entry with the explicit amount and structured choice', async () => {
    const { service, updated } = buildService();

    await service.updateFoodLog(userId, 'log-1', {
      amount: 500,
      amountUnit: 'ML',
      portionKind: 'SERVING',
      portionMultiplier: 2,
      mealCategory: 'DINNER',
    });

    expect(updated[0]).toMatchObject({
      grams: null,
      amount: 500,
      amountUnit: 'ML',
      portionKind: 'SERVING',
      portionMultiplier: 2,
      caloriesComputed: 210,
      mealCategory: 'DINNER',
    });
  });

  it('treats an unchanged new-shape amount and choice as meal-only', async () => {
    const { service, updated, prisma } = buildService({
      product: product({ source: 'ADMIN', declaredNutritionBasis: null }),
      existing: { amount: 600, portionKind: 'PACKAGE', portionMultiplier: 1 },
    });

    await service.updateFoodLog(userId, 'log-1', {
      amount: 600,
      amountUnit: 'ML',
      portionKind: 'PACKAGE',
      portionMultiplier: 1,
      mealCategory: 'DINNER',
    });

    expect(updated).toEqual([{ mealCategory: 'DINNER' }]);
    expect(prisma.foodLogEntry.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { mealCategory: 'DINNER' },
    });
  });

  it('rejects a packaged-product unit mismatch', async () => {
    const { service, prisma } = buildService();
    await expect(
      service.updateFoodLog(userId, 'log-1', {
        amount: 200,
        amountUnit: 'G',
        portionKind: 'CUSTOM',
      }),
    ).rejects.toMatchObject(expectedReason('AMOUNT_UNIT_BASIS_MISMATCH'));
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });

  it('rejects an inconsistent structured choice without rewriting it', async () => {
    const { service, prisma } = buildService();
    await expect(
      service.updateFoodLog(userId, 'log-1', {
        amount: 240,
        amountUnit: 'ML',
        portionKind: 'SERVING',
        portionMultiplier: 1,
      }),
    ).rejects.toMatchObject(expectedReason('PORTION_AMOUNT_MISMATCH'));
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });

  it('allows a meal-only edit when the packaged product is Not scalable', async () => {
    const { service, updated } = buildService({
      product: product({
        source: 'ADMIN',
        declaredNutritionBasis: null,
      }),
    });

    await service.updateFoodLog(userId, 'log-1', {
      mealCategory: 'DINNER',
    });

    expect(updated).toEqual([{ mealCategory: 'DINNER' }]);
  });

  it('rejects an amount edit with the current Not-scalable reason', async () => {
    const { service, prisma } = buildService({
      product: product({
        source: 'ADMIN',
        declaredNutritionBasis: null,
      }),
    });

    await expect(
      service.updateFoodLog(userId, 'log-1', {
        amount: 200,
        amountUnit: 'ML',
        portionKind: 'CUSTOM',
      }),
    ).rejects.toMatchObject(expectedReason('NUTRITION_BASIS_UNKNOWN'));
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });

  it('downgrades PACKAGE x 1 to CUSTOM after a changed legacy grams amount', async () => {
    const { service, updated } = buildService({
      product: product({
        packageSize: 300,
        packageBaseUnit: 'G',
        servingSize: 100,
        servingBaseUnit: 'G',
      }),
      existing: {
        grams: 100,
        amount: 100,
        amountUnit: 'G',
        portionKind: 'PACKAGE',
        portionMultiplier: 1,
      },
    });

    await service.updateFoodLog(userId, 'log-1', { grams: 200 });

    expect(updated[0]).toMatchObject({
      grams: 200,
      amount: 200,
      amountUnit: 'G',
      portionKind: 'CUSTOM',
      portionMultiplier: null,
    });
  });

  it('keeps a null portion choice null after a changed legacy grams amount', async () => {
    const { service, updated } = buildService({
      product: product({
        packageSize: 300,
        packageBaseUnit: 'G',
        servingSize: 100,
        servingBaseUnit: 'G',
      }),
      existing: {
        grams: 100,
        amount: 100,
        amountUnit: 'G',
        portionKind: null,
        portionMultiplier: null,
      },
    });

    await service.updateFoodLog(userId, 'log-1', { grams: 200 });

    expect(updated[0]).toMatchObject({
      grams: 200,
      amount: 200,
      portionKind: null,
      portionMultiplier: null,
    });
  });

  it('preserves a structured choice and skips safety when legacy grams are unchanged', async () => {
    const { service, updated } = buildService({
      product: product({ source: 'ADMIN', declaredNutritionBasis: null }),
      existing: {
        grams: 100,
        amount: 100,
        amountUnit: 'G',
        portionKind: 'PACKAGE',
        portionMultiplier: 1,
      },
    });

    await service.updateFoodLog(userId, 'log-1', {
      grams: 100,
      mealCategory: 'DINNER',
    });

    expect(updated).toEqual([{ mealCategory: 'DINNER' }]);
  });

  it('rejects legacy grams against an equal-valued ML packaged entry', async () => {
    const { service, prisma } = buildService();

    await expect(
      service.updateFoodLog(userId, 'log-1', { grams: 330 }),
    ).rejects.toMatchObject(expectedReason('AMOUNT_UNIT_BASIS_MISMATCH'));
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });

  it('keeps an orphaned packaged-product ML entry uneditable', async () => {
    const { service, prisma } = buildService({ product: null });
    await expect(
      service.updateFoodLog(userId, 'log-1', { mealCategory: 'DINNER' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.foodLogEntry.update).not.toHaveBeenCalled();
  });
});
