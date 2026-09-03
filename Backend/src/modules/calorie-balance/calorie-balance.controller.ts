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
import { CalorieBalanceService } from './calorie-balance.service';
import { CreateExerciseLogDto } from './dto/create-exercise-log.dto';
import { UpdateExerciseLogDto } from './dto/update-exercise-log.dto';
import { DateQueryDto } from './dto/date-query.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class CalorieBalanceController {
  constructor(private readonly calorieBalanceService: CalorieBalanceService) {}

  @Get('sports')
  getSportCatalog() {
    return this.calorieBalanceService.getSportCatalog();
  }

  @Post('exercise-logs')
  logExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateExerciseLogDto,
  ) {
    return this.calorieBalanceService.logExercise(user.userId, dto);
  }

  @Get('exercise-logs')
  listExerciseSessions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DateQueryDto,
  ) {
    return this.calorieBalanceService.listExerciseSessions(
      user.userId,
      query.date,
    );
  }

  @Patch('exercise-logs/:id')
  updateExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateExerciseLogDto,
  ) {
    return this.calorieBalanceService.updateExercise(user.userId, id, dto);
  }

  @Delete('exercise-logs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteExercise(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.calorieBalanceService.deleteExercise(user.userId, id);
  }

  @Get('balance')
  getBalance(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: DateQueryDto,
  ) {
    return this.calorieBalanceService.getDailyBalance(user.userId, query.date);
  }
}
