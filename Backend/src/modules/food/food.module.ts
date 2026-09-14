import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FoodService } from './food.service';
import { FoodSearchService } from './food-search.service';
import { BarcodeLookupCacheService } from './barcode-lookup-cache.service';
import { FoodController } from './food.controller';
import { OpenFoodFactsClient } from './clients/open-food-facts.client';
import { UsdaClient } from './clients/usda.client';

@Module({
  imports: [AuthModule],
  controllers: [FoodController],
  providers: [
    FoodService,
    FoodSearchService,
    BarcodeLookupCacheService,
    OpenFoodFactsClient,
    UsdaClient,
  ],
})
export class FoodModule {}
