import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CalorieBalanceService } from './calorie-balance.service';
import { CalorieBalanceController } from './calorie-balance.controller';

@Module({
  imports: [AuthModule],
  controllers: [CalorieBalanceController],
  providers: [CalorieBalanceService],
  exports: [CalorieBalanceService],
})
export class CalorieBalanceModule {}
