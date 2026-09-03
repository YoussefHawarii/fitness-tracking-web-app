import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CalorieBalanceModule } from '../calorie-balance/calorie-balance.module';
import { WeightPredictionService } from './weight-prediction.service';
import { WeightPredictionController } from './weight-prediction.controller';

@Module({
  imports: [AuthModule, CalorieBalanceModule],
  controllers: [WeightPredictionController],
  providers: [WeightPredictionService],
})
export class WeightPredictionModule {}
