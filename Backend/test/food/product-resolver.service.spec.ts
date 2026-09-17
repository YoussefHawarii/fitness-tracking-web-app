import { BadRequestException } from '@nestjs/common';
import { ProductSource } from '@prisma/client';
import { ProductResolverService } from '../../src/modules/food/product-resolver.service';

// Covers the resolution paths required by the Egyptian-catalog barcode
// pipeline: local-first lookup, provider fallback + persistence, a clean
// "not found" on a complete miss, and provider-failure isolation (never a
// 500 for what is really "no provider could resolve this right now").
describe('ProductResolverService.resolveBarcode', () => {
  const barcode = '3017620422003';
  const localProduct = { id: 'local-row-1', barcode, name: 'Cached product' };
  const providerResult = { name: 'Nutella', caloriesPer100g: 539 };
  const upsertedProduct = { id: 'new-row-1', barcode, name: 'Nutella' };

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

    expect(result).toEqual({ status: 'found', product: localProduct });
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
    expect(result).toEqual({ status: 'found', product: upsertedProduct });
  });

  it('a barcode already resolved once is served from the local DB on the next lookup, without calling the provider again', async () => {
    const { service, packagedProducts, openFoodFacts } = buildService();
    packagedProducts.findByBarcode.mockResolvedValueOnce(null);
    openFoodFacts.lookupByBarcode.mockResolvedValue(providerResult);
    packagedProducts.upsertFromProvider.mockResolvedValue(upsertedProduct);
    await service.resolveBarcode(barcode); // first scan: caches it

    packagedProducts.findByBarcode.mockResolvedValueOnce(upsertedProduct); // now cached
    const second = await service.resolveBarcode(barcode);

    expect(second).toEqual({ status: 'found', product: upsertedProduct });
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
    const saved = { ...upsertedProduct, barcode: equivalentEan13 };
    packagedProducts.findByBarcode
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(saved);
    openFoodFacts.lookupByBarcode.mockResolvedValue(providerResult);
    packagedProducts.upsertFromProvider.mockResolvedValue(saved);

    await service.resolveBarcode(upcA);
    const second = await service.resolveBarcode(equivalentEan13);

    expect(second).toEqual({ status: 'found', product: saved });
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
});
