import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CurrentUser,
  type AuthenticatedUser,
} from '../../common/decorators/current-user.decorator';
import { WeightPredictionService } from './weight-prediction.service';
import { CreateWeighInDto } from './dto/create-weigh-in.dto';

@UseGuards(JwtAuthGuard)
@Controller()
export class WeightPredictionController {
  constructor(
    private readonly weightPredictionService: WeightPredictionService,
  ) {}

  @Post('weigh-ins')
  logWeighIn(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWeighInDto,
  ) {
    return this.weightPredictionService.logWeighIn(user.userId, dto);
  }

  @Get('weigh-ins')
  listWeighIns(@CurrentUser() user: AuthenticatedUser) {
    return this.weightPredictionService.listWeighInsWithComparison(user.userId);
  }

  @Get('prediction')
  getPrediction(
    @CurrentUser() user: AuthenticatedUser,
    @Query('endDate') endDate: string,
  ) {
    return this.weightPredictionService.getPrediction(user.userId, endDate);
  }
}
