import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CalorieBalanceService } from '../calorie-balance/calorie-balance.service';
import {
  calculatePredictedVsActual,
  calculatePredictedWeight,
} from './prediction-calculator';
import { CreateWeighInDto } from './dto/create-weigh-in.dto';

const DEFAULT_WINDOW_DAYS = 7; // within the spec's 1–2 week range

function isoDateNDaysBefore(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class WeightPredictionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calorieBalanceService: CalorieBalanceService,
  ) {}

  async logWeighIn(userId: string, dto: CreateWeighInDto) {
    return this.prisma.weighIn.create({
      data: {
        userId,
        weightKg: dto.weightKg,
        loggedForDate: new Date(dto.date),
      },
    });
  }

  // Sums daily balances for the `windowDays` ending on `date` (inclusive).
  // Returns null if there isn't at least one logged food entry across every
  // day in the window — an explicit "not enough data yet" signal rather than
  // a misleadingly precise number from a partial window.
  private async getCumulativeBalance(
    userId: string,
    endDate: string,
    windowDays: number,
  ): Promise<number | null> {
    let daysWithData = 0;
    let cumulative = 0;

    for (let i = 0; i < windowDays; i++) {
      const date = isoDateNDaysBefore(endDate, i);
      const dayBalance = await this.calorieBalanceService.getDailyBalance(
        userId,
        date,
      );
      if (dayBalance.caloriesConsumed > 0) daysWithData++;
      cumulative += dayBalance.balance;
    }

    if (daysWithData < windowDays) return null;
    return cumulative;
  }

  async getPrediction(
    userId: string,
    endDate: string,
    windowDays: number = DEFAULT_WINDOW_DAYS,
  ) {
    const baseline = await this.prisma.userBaseline.findUnique({
      where: { userId },
    });
    if (!baseline) {
      return {
        insufficientData: true as const,
        reason: 'No baseline set up yet.',
      };
    }

    const cumulativeBalance = await this.getCumulativeBalance(
      userId,
      endDate,
      windowDays,
    );
    if (cumulativeBalance === null) {
      return {
        insufficientData: true as const,
        reason: `Log at least ${windowDays} days of food intake to see a prediction.`,
      };
    }

    const predictedWeightKg = calculatePredictedWeight(
      Number(baseline.currentWeightKg),
      cumulativeBalance,
    );

    return {
      insufficientData: false as const,
      windowDays,
      predictedWeightChangeKg:
        predictedWeightKg - Number(baseline.currentWeightKg),
      predictedWeightKg,
      isDirectionalEstimate: true,
    };
  }

  async listWeighInsWithComparison(userId: string) {
    const weighIns = await this.prisma.weighIn.findMany({
      where: { userId },
      orderBy: { loggedForDate: 'desc' },
    });

    return Promise.all(
      weighIns.map(async (weighIn) => {
        const dateStr = weighIn.loggedForDate.toISOString().slice(0, 10);
        const prediction = await this.getPrediction(userId, dateStr);
        if (prediction.insufficientData) {
          return { ...weighIn, comparison: null };
        }
        return {
          ...weighIn,
          comparison: calculatePredictedVsActual(
            prediction.predictedWeightKg,
            Number(weighIn.weightKg),
          ),
        };
      }),
    );
  }
}
