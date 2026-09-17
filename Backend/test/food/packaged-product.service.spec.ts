import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma, ProductSource, VerificationStatus } from '@prisma/client';
import { PackagedProductService } from '../../src/modules/food/packaged-product.service';
import type { ProductLookupResult } from '../../src/modules/food/providers/product-provider.interface';

function uniqueBarcodeViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target: ['barcode'] },
  });
}

describe('PackagedProductService', () => {
  const barcode = '3017620422003';
  const providerResult: ProductLookupResult = {
    name: 'Nutella',
    caloriesPer100g: 539,
    proteinPer100g: 6.3,
    carbsPer100g: 57.5,
    fatPer100g: 30.9,
  };

  function buildService() {
    const prisma = {
      packagedProduct: {
        create: jest.fn(
          (args: { data: Record<string, unknown> }): Promise<unknown> => {
            void args;
            return Promise.resolve(undefined);
          },
        ),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    const service = new PackagedProductService(prisma as never);
    return { service, prisma };
  }

  describe('upsertFromProvider', () => {
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
    });
  });
});
