import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UserModel } from '../../db/models/user.model';
import { getDayBoundaryUtc } from '../calorie-balance/day-boundary.util';
import { FoodService } from './food.service';
import { FoodSearchService } from './food-search.service';
import { PackagedProductService } from './packaged-product.service';
import { NutritionLabelExtractionService } from './nutrition-label-extraction.service';
import { serializePackagedProduct } from './product-mapper';
import { CreateLocalFoodItemDto } from './dto/create-local-food-item.dto';
import { CreateFoodLogDto } from './dto/create-food-log.dto';
import { UpdateFoodLogDto } from './dto/update-food-log.dto';
import { ListFoodLogsQueryDto } from './dto/list-food-logs-query.dto';
import { SearchFoodQueryDto } from './dto/search-food-query.dto';
import { SearchFoodTranscriptQueryDto } from './dto/search-food-transcript-query.dto';
import { CreatePackagedProductDto } from './dto/create-packaged-product.dto';
import { resolvePackagedProductPortion } from './portion-resolution';

const NUTRITION_LABEL_MAX_BYTES = 5 * 1024 * 1024;
const NUTRITION_LABEL_ALLOWED_MIME = /^image\/(jpeg|png|webp)$/;

@UseGuards(JwtAuthGuard)
@Controller('food')
export class FoodController {
  constructor(
    private readonly foodService: FoodService,
    private readonly foodSearchService: FoodSearchService,
    private readonly userModel: UserModel,
    private readonly packagedProductService: PackagedProductService,
    private readonly nutritionLabelExtraction: NutritionLabelExtractionService,
  ) {}

  @Get('barcode/:code')
  lookupBarcode(@Param('code') code: string) {
    return this.foodService.lookupBarcode(code);
  }

  @Get('products/:id')
  getProduct(@Param('id') id: string) {
    return this.foodService.getPackagedProduct(id);
  }

  // Unknown-barcode fallback (section 14 of the Egyptian-catalog spec): once
  // a scan misses everywhere, the user can submit the product themselves.
  // Requires auth like every other /food route — same trust model as
  // LocalFoodItem creation, just shared across users instead of private.
  @Post('products')
  async createProduct(@Body() dto: CreatePackagedProductDto) {
    const product = await this.packagedProductService.createUserSubmitted(dto);
    const { resolution } = resolvePackagedProductPortion(product);
    return serializePackagedProduct(product, resolution);
  }

  // Nutrition-label scanning foundation (prepared, not wired to a real OCR
  // provider — see NutritionLabelExtractionService). Always resolves with
  // `available: false` today; the frontend must fall back to manual entry.
  @Post('nutrition-label/extract')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: NUTRITION_LABEL_MAX_BYTES },
      fileFilter: (_req, file, callback) => {
        if (!NUTRITION_LABEL_ALLOWED_MIME.test(file.mimetype)) {
          callback(
            new BadRequestException(
              'Only JPEG, PNG, or WebP images are supported.',
            ),
            false,
          );
          return;
        }
        callback(null, true);
      },
    }),
  )
  extractNutritionLabel(@UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('An image file is required.');
    }
    return this.nutritionLabelExtraction.extract(file.buffer, file.mimetype);
  }

  // Manual search uses the canonical bilingual catalog first, then the
  // caller's own LocalFoodItems, then live USDA as the long-tail fallback.
  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchFoodQueryDto,
  ) {
    return this.foodSearchService.search(query.term, user.userId);
  }

  @Get('search-transcript')
  searchTranscript(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchFoodTranscriptQueryDto,
  ) {
    return this.foodSearchService.searchTranscript(
      query.transcript,
      user.userId,
    );
  }

  @Post('local-items')
  createLocalItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLocalFoodItemDto,
  ) {
    return this.foodService.createLocalFoodItem(user.userId, dto);
  }

  @Get('local-items')
  listLocalItems(@CurrentUser() user: AuthenticatedUser) {
    return this.foodService.listLocalFoodItems(user.userId);
  }

  @Post('logs')
  createLog(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFoodLogDto,
  ) {
    return this.foodService.createFoodLog(user.userId, dto);
  }

  @Get('logs')
  async listLogsForDay(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListFoodLogsQueryDto,
  ) {
    // Token references a user that no longer exists (e.g. a deleted account
    // whose access token hasn't expired yet) — fail cleanly instead of
    // letting Prisma's not-found error surface as a 500.
    const record = await this.userModel.findByIdOrThrow(user.userId);
    const { startUtc, endUtc } = getDayBoundaryUtc(query.date, record.timezone);
    return this.foodService.listFoodLogsForDay(user.userId, startUtc, endUtc);
  }

  @Patch('logs/:id')
  updateLog(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFoodLogDto,
  ) {
    return this.foodService.updateFoodLog(user.userId, id, dto);
  }

  @Delete('logs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLog(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.foodService.deleteFoodLog(user.userId, id);
  }
}
