import {
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
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { UserModel } from '../../db/models/user.model';
import { getDayBoundaryUtc } from '../calorie-balance/day-boundary.util';
import { FoodService } from './food.service';
import { FoodSearchService } from './food-search.service';
import { CreateLocalFoodItemDto } from './dto/create-local-food-item.dto';
import { CreateFoodLogDto } from './dto/create-food-log.dto';
import { UpdateFoodLogDto } from './dto/update-food-log.dto';
import { ListFoodLogsQueryDto } from './dto/list-food-logs-query.dto';
import { SearchFoodQueryDto } from './dto/search-food-query.dto';

@UseGuards(JwtAuthGuard)
@Controller('food')
export class FoodController {
  constructor(
    private readonly foodService: FoodService,
    private readonly foodSearchService: FoodSearchService,
    private readonly userModel: UserModel,
  ) {}

  @Get('barcode/:code')
  lookupBarcode(@Param('code') code: string) {
    return this.foodService.lookupBarcode(code);
  }

  // Shared by Manual search and Voice (both call this) — canonical bilingual
  // catalog first, then the caller's own LocalFoodItems, then live USDA as
  // the long-tail fallback. See docs/food-log-input-modes-diagnosis.md §3.4.
  @Get('search')
  search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchFoodQueryDto,
  ) {
    return this.foodSearchService.search(query.term, user.userId);
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
