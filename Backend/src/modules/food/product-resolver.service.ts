import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { PackagedProduct } from '@prisma/client';
import { normalizeBarcode } from './barcode-normalizer';
import { PackagedProductService } from './packaged-product.service';
import { OpenFoodFactsProvider } from './providers/open-food-facts.provider';
import type {
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
  | { status: 'not_found' }
  // A configured provider errored (timeout/outage) and no other provider (nor
  // the local DB) resolved the barcode — distinct from a clean "not found" so
  // the caller doesn't tell the user a product genuinely doesn't exist when
  // the truth is just "couldn't check right now".
  | { status: 'unavailable' };

// Orchestrates barcode -> product resolution: local DB first, then each
// configured provider in order, persisting the first hit. Adding a future
// Egyptian provider (GS1 Egypt, a licensed FMCG database, ...) means adding
// it to `providers` below — this class, the controller, and the DTOs are
// otherwise untouched.
@Injectable()
export class ProductResolverService {
  private readonly logger = new Logger(ProductResolverService.name);
  private readonly providers: ProductProvider[];

  constructor(
    private readonly packagedProducts: PackagedProductService,
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
    this.logger.log(`barcode local miss: ${barcode}`);

    let providerErrored = false;
    for (const provider of this.providers) {
      let result: ProductLookupResult | null;
      try {
        result = await provider.lookupByBarcode(barcode);
      } catch (err) {
        // Isolate the failure — one slow/unavailable provider must not
        // surface as a 500, and must not block trying the next provider.
        providerErrored = true;
        this.logger.warn(
          `provider error (${provider.source}) for ${barcode}: ${(err as Error).message}`,
        );
        continue;
      }
      if (!result) {
        this.logger.log(`${provider.source} miss: ${barcode}`);
        continue;
      }
      this.logger.log(`${provider.source} hit: ${barcode}`);
      // Catalog failures are internal persistence errors, not provider
      // outages. Keep this write outside the provider-isolation catch so a
      // database failure is not mislabeled as a temporary OFF problem.
      const saved = await this.packagedProducts.upsertFromProvider(
        barcode,
        result,
        provider.source,
      );
      return this.resolvedProduct(barcode, saved);
    }

    return providerErrored
      ? { status: 'unavailable' }
      : { status: 'not_found' };
  }
}
