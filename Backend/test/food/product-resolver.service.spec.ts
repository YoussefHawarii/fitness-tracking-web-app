import { BadRequestException, Logger } from '@nestjs/common';
import {
  BaseUnit,
  ContainerKey,
  NutritionBasis,
  Prisma,
  ProductSource,
  VerificationStatus,
  type PackagedProduct,
} from '@prisma/client';
import { ProductResolverService } from '../../src/modules/food/product-resolver.service';

// Covers the resolution paths required by the Egyptian-catalog barcode
// pipeline: local-first lookup, provider fallback + persistence, a clean
// "not found" on a complete miss, and provider-failure isolation (never a
// 500 for what is really "no provider could resolve this right now").
describe('ProductResolverService.resolveBarcode', () => {
  const barcode = '3017620422003';
  function productRow(
    overrides: Partial<PackagedProduct> = {},
  ): PackagedProduct {
    return {
      id: 'local-row-1',
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
  const localProduct = productRow();
  const providerResult = { name: 'Nutella', caloriesPer100g: 539 };
  const upsertedProduct = productRow({ id: 'new-row-1', name: 'Nutella' });
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

  function found(product: PackagedProduct) {
    return { status: 'found', product, resolution: expectedResolution };
  }

  function buildService() {
    const packagedProducts = {
      findByBarcode: jest.fn(),
      upsertFromProvider: jest.fn(),
    };
    const openFoodFacts = {
      source: ProductSource.OPEN_FOOD_FACTS,
      lookupByBarcode: jest.fn(),
    };
    const service = new ProductResolverService(
      packagedProducts as never,
      openFoodFacts as never,
    );
    return { service, packagedProducts, openFoodFacts };
  }

  it('returns a local hit without ever calling a provider', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValue(localProduct);

    const result = await service.resolveBarcode(barcode);

    expect(result).toEqual(found(localProduct));
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
    expect(packagedProducts.upsertFromProvider).not.toHaveBeenCalled();
  });

  it('on a local miss, resolves via the provider, persists, and returns the saved row', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue(providerResult);
    packagedProducts.upsertFromProvider.mockResolvedValue(upsertedProduct);

    const result = await service.resolveBarcode(barcode);

    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledWith(barcode);
    expect(packagedProducts.upsertFromProvider).toHaveBeenCalledWith(
      barcode,
      providerResult,
      ProductSource.OPEN_FOOD_FACTS,
    );
    expect(result).toEqual(found(upsertedProduct));
  });

  it('a barcode already resolved once is served from the local DB on the next lookup, without calling the provider again', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValueOnce(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue(providerResult);
    packagedProducts.upsertFromProvider.mockResolvedValue(upsertedProduct);
    await service.resolveBarcode(barcode); // first scan: caches it

    packagedProducts.findByBarcode.mockResolvedValueOnce(upsertedProduct); // now cached
    const second = await service.resolveBarcode(barcode);

    expect(second).toEqual(found(upsertedProduct));
    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(1); // not called again
  });

  it('returns not_found when the local DB misses and every provider misses too', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue(null);

    const result = await service.resolveBarcode(barcode);

    expect(result).toEqual({ status: 'not_found' });
    expect(packagedProducts.upsertFromProvider).not.toHaveBeenCalled();
  });

  it('isolates a provider failure as "unavailable" rather than throwing/500ing', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockRejectedValue(new Error('OFF is down'));

    const result = await service.resolveBarcode(barcode);

    expect(result).toEqual({ status: 'unavailable' });
  });

  it('does not misreport a catalog persistence failure as a provider outage', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValue(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue(providerResult);
    packagedProducts.upsertFromProvider.mockRejectedValue(
      new Error('database connection lost'),
    );

    await expect(service.resolveBarcode(barcode)).rejects.toThrow(
      'database connection lost',
    );
  });

  it('resolves UPC-A and its EAN-13 spelling through the same catalog key', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    const upcA = '012345678905';
    const equivalentEan13 = '0012345678905';
    const saved = productRow({
      id: upsertedProduct.id,
      name: upsertedProduct.name,
      barcode: equivalentEan13,
      sourceId: equivalentEan13,
    });
    packagedProducts.findByBarcode
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(saved);
    openFoodFacts.lookupByBarcode.mockResolvedValue(providerResult);
    packagedProducts.upsertFromProvider.mockResolvedValue(saved);

    await service.resolveBarcode(upcA);
    const second = await service.resolveBarcode(equivalentEan13);

    expect(second).toEqual(found(saved));
    expect(packagedProducts.findByBarcode).toHaveBeenNthCalledWith(
      1,
      equivalentEan13,
    );
    expect(packagedProducts.findByBarcode).toHaveBeenNthCalledWith(
      2,
      equivalentEan13,
    );
    expect(openFoodFacts.lookupByBarcode).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid barcode format before touching the local DB or any provider', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();

    await expect(
      service.resolveBarcode('not-a-barcode'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(packagedProducts.findByBarcode).not.toHaveBeenCalled();
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });

  it('rejects a corrupted GS1 check digit before touching the catalog or provider', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();

    await expect(
      service.resolveBarcode('3017620422004'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(packagedProducts.findByBarcode).not.toHaveBeenCalled();
    expect(openFoodFacts.lookupByBarcode).not.toHaveBeenCalled();
  });

  it('logs a discarded serving as diagnostics while returning a loggable product', async () => {
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

    const result = await service.resolveBarcode(barcode);

    expect(result).toMatchObject({
      status: 'found',
      resolution: {
        outcome: 'LOGGABLE',
        portionDimension: 'VOLUME',
        serving: null,
      },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('DIMENSION_MISMATCH'),
    );
    warn.mockRestore();
  });
});
