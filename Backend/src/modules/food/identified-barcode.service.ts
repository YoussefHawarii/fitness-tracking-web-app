import { Injectable } from '@nestjs/common';
import {
  IdentifiedBarcodeReason,
  type IdentifiedBarcode,
  type ProductSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { IdentifiedProductLookup } from './providers/product-provider.interface';

@Injectable()
export class IdentifiedBarcodeService {
  constructor(private readonly prisma: PrismaService) {}

  findByBarcode(barcode: string): Promise<IdentifiedBarcode | null> {
    return this.prisma.identifiedBarcode.findUnique({ where: { barcode } });
  }

  upsertNutritionMissing(
    barcode: string,
    identification: IdentifiedProductLookup,
    source: ProductSource,
    checkedAt: Date,
  ): Promise<IdentifiedBarcode> {
    return this.prisma.identifiedBarcode.upsert({
      where: { barcode },
      create: {
        barcode,
        displayName: identification.name,
        brand: identification.brand,
        imageUrl: identification.imageUrl,
        reason: IdentifiedBarcodeReason.NUTRITION_MISSING,
        source,
        lastProviderCheckAt: checkedAt,
      },
      update: {
        displayName: identification.name,
        brand: identification.brand,
        imageUrl: identification.imageUrl,
        reason: IdentifiedBarcodeReason.NUTRITION_MISSING,
        source,
        lastProviderCheckAt: checkedAt,
      },
    });
  }

  advanceProviderCheck(
    barcode: string,
    checkedAt: Date,
  ): Promise<IdentifiedBarcode> {
    return this.prisma.identifiedBarcode.update({
      where: { barcode },
      data: { lastProviderCheckAt: checkedAt },
    });
  }
}
