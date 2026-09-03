import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { FoodModule } from './modules/food/food.module';
import { CalorieBalanceModule } from './modules/calorie-balance/calorie-balance.module';
import { WeightPredictionModule } from './modules/weight-prediction/weight-prediction.module';
import { UserThrottlerGuard } from './common/guards/user-throttler.guard';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    // 50 requests / rolling 5 minutes, keyed per user (or per IP if
    // unauthenticated) via UserThrottlerGuard below — FR-007 through FR-011.
    ThrottlerModule.forRoot([{ ttl: 300_000, limit: 50 }]),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    FoodModule,
    CalorieBalanceModule,
    WeightPredictionModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: UserThrottlerGuard }],
})
export class AppModule {}
