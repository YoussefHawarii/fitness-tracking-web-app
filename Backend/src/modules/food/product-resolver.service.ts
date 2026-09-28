import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type {
  IdentifiedBarcode,
  PackagedProduct,
  ProductSource,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeBarcode } from './barcode-normalizer';
import { IdentifiedBarcodeService } from './identified-barcode.service';
import {
  isUniqueBarcodeViolation,
  PackagedProductService,
} from './packaged-product.service';
import {
  classifyProviderCheck,
  isProviderRecheckDue,
  TransientProviderBackoff,
} from './provider-retry-policy';
import { OpenFoodFactsProvider } from './providers/open-food-facts.provider';
import type {
  CataloguableProductLookup,
  ProductLookupResult,
  ProductProvider,
} from './providers/product-provider.interface';
import {
  resolvePackagedProductPortion,
  type PortionResolution,
  type PortionResolutionDiagnostics,
} from './portion-resolution';

export type ResolveBarcodeResult =
  | {
      status: 'found';
      product: PackagedProduct;
      resolution: PortionResolution;
    }
  | { status: 'identified'; identification: IdentifiedBarcode }
  | { status: 'not_found' }
  | { status: 'unavailable' };

@Injectable()
export class ProductResolverService {
  private readonly logger = new Logger(ProductResolverService.name);
  private readonly providers: ProductProvider[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly packagedProducts: PackagedProductService,
    private readonly identifiedBarcodes: IdentifiedBarcodeService,
    private readonly transientBackoff: TransientProviderBackoff,
    openFoodFacts: OpenFoodFactsProvider,
  ) {
    this.providers = [openFoodFacts];
  }

  private resolvedProduct(
    barcode: string,
    product: PackagedProduct,
  ): Extract<ResolveBarcodeResult, { status: 'found' }> {
    const { resolution, diagnostics } = resolvePackagedProductPortion(product);
    this.logDiagnostics(barcode, diagnostics);
    return { status: 'found', product, resolution };
  }

  private identified(
    identification: IdentifiedBarcode,
  ): Extract<ResolveBarcodeResult, { status: 'identified' }> {
    return { status: 'identified', identification };
  }

  private logDiagnostics(
    barcode: string,
    diagnostics: PortionResolutionDiagnostics,
  ): void {
    if (diagnostics.servingDiscardReason) {
      this.logger.warn(
        `serving shortcut discarded for ${barcode}: ${diagnostics.servingDiscardReason}`,
      );
    }
    if (diagnostics.reasons.length > 0) {
      this.logger.warn(
        `product is Not scalable for ${barcode}: ${diagnostics.reasons.join(',')}`,
      );
    }
  }

  private async checkProvider(
    provider: ProductProvider,
    barcode: string,
  ): Promise<ReturnType<typeof classifyProviderCheck>> {
    if (this.transientBackoff.isBlocked(provider.source, barcode)) {
      return classifyProviderCheck({
        error: new ServiceUnavailableException(
          'Provider retry is temporarily backed off.',
        ),
      });
    }
    try {
      const result = await provider.lookupByBarcode(barcode);
      this.transientBackoff.clear(provider.source, barcode);
      return classifyProviderCheck({ result });
    } catch (error) {
      const classified = classifyProviderCheck({ error });
      if (classified.kind === 'TRANSIENT_FAILURE') {
        this.transientBackoff.recordFailure(provider.source, barcode);
      }
      return classified;
    }
  }

  private logProviderFailure(
    source: ProductSource,
    barcode: string,
    check: Exclude<
      ReturnType<typeof classifyProviderCheck>,
      { kind: 'COMPLETED_CHECK' }
    >,
  ): void {
    const message = `provider error (${source}) for ${barcode}: ${String(check.error)}`;
    if (check.kind === 'TRANSIENT_FAILURE') {
      this.logger.warn(message);
      return;
    }
    this.logger.error(message);
  }

  private providerFor(source: ProductSource): ProductProvider | undefined {
    return this.providers.find((provider) => provider.source === source);
  }

  private async supersedeIdentification(
    barcode: string,
    data: CataloguableProductLookup,
    source: ProductSource,
  ): Promise<PackagedProduct> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const product = await this.packagedProducts.createFromProvider(
          barcode,
          data,
          source,
          tx,
        );
        await tx.identifiedBarcode.deleteMany({ where: { barcode } });
        return product;
      });
    } catch (error) {
      if (!isUniqueBarcodeViolation(error)) throw error;
      return this.prisma.$transaction(async (tx) => {
        const product = await tx.packagedProduct.findUniqueOrThrow({
          where: { barcode },
        });
        await tx.identifiedBarcode.deleteMany({ where: { barcode } });
        return product;
      });
    }
  }

  private async recheckIdentification(
    barcode: string,
    existing: IdentifiedBarcode,
    now: Date,
  ): Promise<ResolveBarcodeResult> {
    const provider = this.providerFor(existing.source);
    if (!provider) return this.identified(existing);

    const check = await this.checkProvider(provider, barcode);
    if (check.kind !== 'COMPLETED_CHECK') {
      this.logProviderFailure(provider.source, barcode, check);
      return this.identified(existing);
    }

    return this.applyRecheckResult(barcode, provider, check.result, now);
  }

  private async applyRecheckResult(
    barcode: string,
    provider: ProductProvider,
    result: ProductLookupResult,
    now: Date,
  ): Promise<ResolveBarcodeResult> {
    if (result.outcome === 'FOUND_WITH_NUTRITION') {
      const product = await this.supersedeIdentification(
        barcode,
        result.product,
        provider.source,
      );
      return this.resolvedProduct(barcode, product);
    }
    if (result.outcome === 'FOUND_WITHOUT_NUTRITION') {
      const refreshed = await this.identifiedBarcodes.upsertNutritionMissing(
        barcode,
        result.identification,
        provider.source,
        now,
      );
      return this.identified(refreshed);
    }
    const refreshed = await this.identifiedBarcodes.advanceProviderCheck(
      barcode,
      now,
    );
    return this.identified(refreshed);
  }

  async resolveBarcode(rawBarcode: string): Promise<ResolveBarcodeResult> {
    const normalized = normalizeBarcode(rawBarcode);
    if (!normalized) {
      throw new BadRequestException(
        'Not a recognized EAN-13/EAN-8/UPC-A/UPC-E barcode.',
      );
    }
    const barcode = normalized.canonical;

    const local = await this.packagedProducts.findByBarcode(barcode);
    if (local) {
      this.logger.log(`barcode local hit: ${barcode}`);
      return this.resolvedProduct(barcode, local);
    }

    const identification = await this.identifiedBarcodes.findByBarcode(barcode);
    if (identification) {
      const now = new Date();
      if (!isProviderRecheckDue(identification.lastProviderCheckAt, now)) {
        return this.identified(identification);
      }
      return this.recheckIdentification(barcode, identification, now);
    }

    let providerErrored = false;
    for (const provider of this.providers) {
      const check = await this.checkProvider(provider, barcode);
      if (check.kind !== 'COMPLETED_CHECK') {
        providerErrored = true;
        this.logProviderFailure(provider.source, barcode, check);
        continue;
      }
      const result = check.result;
      if (result.outcome === 'NOT_FOUND') continue;
      if (result.outcome === 'FOUND_WITHOUT_NUTRITION') {
        const saved = await this.identifiedBarcodes.upsertNutritionMissing(
          barcode,
          result.identification,
          provider.source,
          new Date(),
        );
        return this.identified(saved);
      }
      const saved = await this.supersedeIdentification(
        barcode,
        result.product,
        provider.source,
      );
      return this.resolvedProduct(barcode, saved);
    }

    return providerErrored
      ? { status: 'unavailable' }
      : { status: 'not_found' };
  }
}
